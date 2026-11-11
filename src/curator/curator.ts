// The Curator: the built-in agent that keeps each company's record true and tells the owner what needs them.
// This is the ONLY module that imports Pi Durable. Each company has its own agent file (<slug>.agent.sqlite)
// next to its record file; the agent reaches records only through run(), as the actor "curator", so it is
// held to the same rules as every other caller plus the Curator's own (operations/curator.ts).
import { join } from "node:path";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks";
import { createRegistry, defineExtension, defineTool, Harness, section } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Actor } from "../core/agents.ts";
import type { Companies } from "../core/companies.ts";
import type { Company } from "../core/company.ts";
import { RsError } from "../core/errors.ts";
import { changes } from "../core/records.ts";
import { operations, run } from "../operations/index.ts";
import { briefingPrompt, reviewPrompt, systemPrompt, upkeepPrompt } from "./prompts.ts";
import { upkeepFindings } from "./scan.ts";
import { getMeta, getSettings, setMeta, type CuratorSettings } from "./settings.ts";

export const CURATOR: Actor = { kind: "curator", name: "curator", role: "member" };
// Tools the Curator gets: every read, and the three writes its rules allow. Never keys, never attachments' bytes.
const WRITE_TOOLS = new Set(["record.create", "record.patch", "request.propose"]);
const HIDDEN = new Set(["agent.key", "agent.presence", "blob.get", "changes.since"]);
const toolName = (op: string) => op.replace(/\./g, "_");
const MAX_TOOL_TEXT = 12_000;
const SKIP_ACTORS = new Set(["curator", "import", "payload-importer", "system"]);
const SKIP_KINDS = new Set(["flag", "request", "briefing", "job"]);

export type FauxProvider = ReturnType<typeof fauxProvider>;
export type ChatMessage = { who: "you" | "curator" | "tool"; text: string };
export type ChatState = { busy: boolean; messages: ChatMessage[]; partial: string | null; tools: string[] };
export type RunReport = { duty: string; status: "done" | "skipped" | "failed"; detail: string; cost_usd: number };
type Usage = { models?: Record<string, { cost?: { total?: number } }> };
type Conversation = Awaited<ReturnType<Harness["createConversation"]>>;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const totalCost = (u: Usage) => Object.values(u.models ?? {}).reduce((t, m) => t + (m.cost?.total ?? 0), 0);
const today = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hourNow = (tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));

/** The Curator of one company: its agent file, its tools, its duties. */
class CompanyCurator {
  private busyDuty = false;
  private readonly company: Company;
  private readonly harness: Harness;
  private readonly root: Conversation;
  private readonly provider: string;

  constructor(company: Company, harness: Harness, root: Conversation, provider: string) {
    this.company = company; this.harness = harness; this.root = root; this.provider = provider;
  }

  static async open(dataDir: string, company: Company, models: ReturnType<typeof createModels>, provider: string): Promise<CompanyCurator> {
    const tools = operations.filter((o) => !HIDDEN.has(o.name) && !o.replacedBy && (!o.write || WRITE_TOOLS.has(o.name))).map((o) => defineTool({
      name: toolName(o.name), description: o.summary, parameters: o.input, replay: "safe",
      execute: async (args, api) => {
        try {
          // The tool call's id is the op id, so a run that crashed and restarts writes each change once.
          const out = run(company, CURATOR, o.name, args, o.write ? `curator-tool:${String(api.taskId)}` : undefined);
          const s = JSON.stringify(out);
          return text(s.length > MAX_TOOL_TEXT ? `${s.slice(0, MAX_TOOL_TEXT)} … (cut: ask for less with limit, or read one record)` : s);
        } catch (e) {
          if (e instanceof RsError) return text(`refused (${e.code}): ${e.message}`);
          throw e;
        }
      },
    }));
    const registry = createRegistry();
    registry.install(defineExtension({
      name: "resultspace", tools,
      sections: [section("curator", async () => systemPrompt(company, getSettings(company).instructions), { tag: false })],
    }));
    const harness = await Harness.open(await openNodeSqliteStorage(join(dataDir, `${company.slug}.agent.sqlite`)), { models, registry, settings: { retry: { maxRetries: 3 }, toolExecution: "sequential" } }, ctx);
    const s = getSettings(company);
    const root = await harness.root(ctx, { agent: { model: { provider, modelId: provider === "faux" ? "faux-1" : s.model }, thinkingLevel: s.thinking } });
    harness.resume(); // continue anything a previous process left unfinished
    return new CompanyCurator(company, harness, root, provider);
  }

  private agent(s: CuratorSettings, strong = false) {
    return { model: { provider: this.provider, modelId: this.provider === "faux" ? "faux-1" : strong ? s.model_strong : s.model }, thinkingLevel: s.thinking };
  }

  private async spent(): Promise<number> { return totalCost((await this.harness.usage(ctx)) as Usage); }

  /** Dollars spent today on this company. The day's first look remembers the running total. */
  async spentToday(): Promise<number> {
    const total = await this.spent(); const key = `curator.spend_base.${today("UTC")}`;
    const base = getMeta(this.company, key);
    if (base === undefined) { setMeta(this.company, key, String(total)); return 0; }
    return Math.max(0, total - Number(base));
  }

  /** A sentence when the day's limit is reached, else null. */
  async overLimit(): Promise<string | null> {
    const cap = getSettings(this.company).daily_cap_usd; const spent = await this.spentToday();
    return cap > 0 && spent >= cap ? `The Curator reached today's spending limit for ${this.company.name} ($${spent.toFixed(2)} of $${cap}). Raise it in Admin.` : null;
  }

  // ---- Chat with a person ----
  async say(textIn: string, steer = false): Promise<{ ok: true } | { ok: false; error: string }> {
    const limit = await this.overLimit();
    if (limit) return { ok: false, error: limit };
    await this.root.configure(this.agent(getSettings(this.company)), ctx);
    await this.root.submit({ type: "input", content: textIn, whenBusy: steer ? "steer" : "followUp" }, ctx);
    return { ok: true };
  }
  async stop(): Promise<void> { await this.root.abort(ctx); }
  /** Start a fresh chat. The old one stays in the agent file; the record is unaffected. */
  async newChat(): Promise<void> { await this.root.reset(undefined, ctx); }
  async chat(): Promise<ChatState> { return conversationState(this.root); }
  async waitForChat(): Promise<void> { await this.root.waitForIdle(ctx); }

  // ---- Duties: a fresh conversation each time. Lasting state lives in records, not in a transcript. ----
  private async duty(duty: string, prompt: string, strong: boolean, requestId: string): Promise<RunReport> {
    if (this.busyDuty) return { duty, status: "skipped", detail: "another duty is running", cost_usd: 0 };
    const limit = await this.overLimit();
    if (limit) return { duty, status: "skipped", detail: limit, cost_usd: 0 };
    this.busyDuty = true;
    const before = await this.spent(); const started = new Date().toISOString();
    this.company.run("insert into curator_runs (duty, started_at) values (?, ?)", duty, started);
    const id = this.company.one<{ id: number }>("select max(id) as id from curator_runs")!.id;
    let status: RunReport["status"] = "done"; let detail = "";
    try {
      const conv = await this.harness.createConversation({ ownership: { kind: "ownerless" }, agent: this.agent(getSettings(this.company), strong) }, ctx);
      await conv.submit({ type: "input", content: prompt, requestId }, ctx);
      await conv.waitForIdle(ctx);
      detail = (await conversationState(conv)).messages.filter((m) => m.who === "curator").at(-1)?.text.slice(0, 500) ?? "";
    } catch (e) {
      status = "failed"; detail = e instanceof Error ? e.message : String(e);
    } finally {
      this.busyDuty = false;
    }
    const cost = Math.max(0, (await this.spent()) - before);
    this.company.run("update curator_runs set finished_at = ?, status = ?, detail = ?, cost_usd = ? where id = ?", new Date().toISOString(), status, detail, cost, id);
    return { duty, status, detail, cost_usd: cost };
  }

  /** Review what agents and people wrote since the last review. Returns null when there is nothing new. */
  async review(): Promise<RunReport | null> {
    const since = Number(getMeta(this.company, "curator.review_seq") ?? "-1");
    const last = this.company.one<{ n: number | null }>("select max(seq) as n from revisions")?.n ?? 0;
    if (since < 0) { setMeta(this.company, "curator.review_seq", String(last)); return null; } // first run: start from now, not from history
    const fresh = changes(this.company, since, 500);
    if (!fresh.length) return null;
    const batch = fresh.filter((v) => !SKIP_ACTORS.has(v.actor) && !SKIP_KINDS.has(v.kind) && !(v.kind === "entry" && v.body.type === "session")).slice(0, 40);
    const upTo = batch.length === 40 ? batch[39]!.seq : fresh.at(-1)!.seq;
    // A knowledge page that changed may have made a skill stale: the skills that cite it go into the review.
    const skills = batch.filter((v) => v.kind === "knowledge" && v.op !== "create").flatMap((v) =>
      this.company.all<{ skill: string }>("select s.key as skill from links l join records s on s.id = l.from_id where l.to_id = ? and s.kind = 'skill' and s.archived = 0", v.record_id)
        .map((x) => ({ skill: x.skill, knowledge: v.key })));
    const report = batch.length ? await this.duty("review", reviewPrompt(this.company, batch, skills), false, `review:${upTo}`) : null;
    if (!report || report.status === "done") setMeta(this.company, "curator.review_seq", String(upTo));
    return report;
  }

  /** Write today's briefing, once a day. */
  async briefing(person: string, tz: string, force = false): Promise<RunReport | null> {
    const date = today(tz);
    if (!force && getMeta(this.company, "curator.briefing_date") === date) return null;
    const report = await this.duty("briefing", briefingPrompt(this.company, date, person), true, `briefing:${date}${force ? `:${Date.now()}` : ""}`);
    if (report.status === "done") setMeta(this.company, "curator.briefing_date", date);
    return report;
  }

  /** Scan for stale, stuck and duplicate records and judge them, once a day. */
  async upkeep(tz: string, force = false): Promise<RunReport | null> {
    const date = today(tz);
    if (!force && getMeta(this.company, "curator.upkeep_date") === date) return null;
    const findings = upkeepFindings(this.company);
    const report = findings.length ? await this.duty("upkeep", upkeepPrompt(findings), true, `upkeep:${date}${force ? `:${Date.now()}` : ""}`) : null;
    if (!report || report.status === "done") setMeta(this.company, "curator.upkeep_date", date);
    return report;
  }

  runs(limit = 20) {
    return this.company.all<{ id: number; duty: string; started_at: string; finished_at: string | null; status: string; detail: string | null; cost_usd: number }>(
      "select * from curator_runs order by id desc limit ?", limit).map((r) => ({ ...r }));
  }

  async close(): Promise<void> { await this.harness.close(ctx); }
}

type Block = { type?: string; text?: string; name?: string; arguments?: unknown };
type Message = { role?: string; content?: string | Block[]; stopReason?: string; errorMessage?: string };

async function conversationState(conv: Conversation): Promise<ChatState> {
  const view = await conv.viewState(ctx);
  const v = view.value as unknown as { entries: readonly { model?: Message[] }[]; docs: Record<string, unknown> };
  view.dispose();
  const messages: ChatMessage[] = [];
  for (const e of v.entries) for (const m of e.model ?? []) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content ?? []);
    if (m.role === "user") messages.push({ who: "you", text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") });
    if (m.role === "assistant") {
      for (const b of blocks) {
        if (b.type === "text" && b.text?.trim()) messages.push({ who: "curator", text: b.text });
        if (b.type === "toolCall") messages.push({ who: "tool", text: `${b.name ?? "tool"} ${JSON.stringify(b.arguments ?? {}).slice(0, 160)}` });
      }
      if (m.stopReason === "error" && m.errorMessage) messages.push({ who: "tool", text: `error: ${m.errorMessage}` });
    }
  }
  const live = v.docs["pi.live"] as { run?: unknown; generation?: { message?: { content?: Block[] } }; tools?: { status?: string; name?: string }[] } | undefined;
  const partial = (live?.generation?.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  return { busy: !!live?.run, messages, partial: partial || null, tools: (live?.tools ?? []).filter((t) => t.status !== "done").map((t) => t.name ?? "tool") };
}

/** Every company's Curator on this server. */
export class Curator {
  private readonly open_ = new Map<string, Promise<CompanyCurator>>();
  private readonly models = createModels();
  private readonly provider: string;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  available: boolean;
  private readonly companies: Companies;
  private readonly dataDir: string;
  private readonly tz: string;
  private readonly briefingHour: number;
  private readonly person: string;

  constructor(companies: Companies, o: { dataDir: string; faux?: FauxProvider | undefined; tz?: string | undefined; briefingHour?: number | undefined; person?: string | undefined }) {
    this.companies = companies; this.dataDir = o.dataDir;
    this.tz = o.tz ?? process.env.RS_TZ ?? "America/Denver";
    this.briefingHour = o.briefingHour ?? Number(process.env.RS_BRIEFING_HOUR ?? 6);
    this.person = o.person ?? "the owner";
    if (o.faux) { this.models.setProvider(o.faux.provider); this.provider = "faux"; this.available = true; }
    else { this.models.setProvider(fireworksProvider()); this.provider = "fireworks"; this.available = !!process.env.FIREWORKS_API_KEY; }
  }

  /** A model key arrived (first-run setup or Admin): turn the Curator on. */
  enable(): void {
    if (this.provider !== "fireworks" || !process.env.FIREWORKS_API_KEY) return;
    this.models.setProvider(fireworksProvider());
    this.available = true;
  }

  for(slug: string): Promise<CompanyCurator> {
    let c = this.open_.get(slug);
    if (!c) { c = CompanyCurator.open(this.dataDir, this.companies.get(slug), this.models, this.provider); this.open_.set(slug, c); c.catch(() => this.open_.delete(slug)); }
    return c;
  }

  /** One pass over every company: review new writes; once a day, after the briefing hour, upkeep and the briefing. */
  async tick(): Promise<RunReport[]> {
    if (this.ticking || !this.available) return [];
    this.ticking = true; const out: RunReport[] = [];
    try {
      for (const slug of this.companies.slugs()) {
        try {
          if (!getSettings(this.companies.get(slug)).auto) continue;
          const c = await this.for(slug);
          const push = (r: RunReport | null) => { if (r) out.push(r); };
          push(await c.review());
          if (hourNow(this.tz) >= this.briefingHour) { push(await c.upkeep(this.tz)); push(await c.briefing(this.person, this.tz)); }
        } catch (e) { console.error(`curator: ${slug}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    } finally { this.ticking = false; }
    return out;
  }

  /** Run tick() every `seconds`. */
  start(seconds = 60): void {
    if (this.timer || !this.available) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.open_.values()) await (await c).close().catch(() => undefined);
    this.open_.clear();
  }
}
