// Read views built from records: the brief an agent starts a session with, results, activity, today.
import { Type } from "typebox";
import type { Company } from "../core/company.ts";
import * as records from "../core/records.ts";
import { ENTRY_TYPES } from "../core/schema.ts";
import { Limit, meta, op, sinceTime, who, type Operation } from "./define.ts";
import { assignmentOf, openAssignments, STATUS_WORDS } from "./assignments.ts";

export const WRITING_RULES = [
  "Put the result first: what changed or what is now true, not the effort.",
  "Keep sentences short: 20 words for an instruction, 25 for a description.",
  "Use the active voice and simple tenses. Write \"we sent\", not \"has been sent\".",
  "Write one instruction per sentence. Put a condition first: \"If X, do Y.\"",
  "Delete hedges and filler (should, may, could, in order to, leverage, robust).",
];
const STANDING = "Assignments: `rs assignment next`, report with `rs assignment report <KEY> --result \"outcome\"` (a report is your word; "
  + "a person verifies it). Outward actions (spend, ads, publish, email/message customers, prices, store settings, deploy) need no permission: "
  + "record each one with `rs act <action> --detail \"…\" [--amount N --unit $]` so a person sees it.";

/** The company's own record (kind `company`), if it has one. Its `brief` field is what agents read first. */
export const companyRecord = (co: Company): records.Rec | undefined => records.list(co, { kind: "company", limit: 1 })[0];

const key = (co: Company, id: unknown): string | null => (typeof id === "string" ? (records.get(co, id)?.key ?? null) : null);

export function briefText(co: Company, agent: string | null, budget = 4000): string {
  const lines = [`## ${co.name} (${co.slug})`];
  const brief = companyRecord(co)?.body.brief;
  // The company's own words get at most 40% of the room, so goals and assignments always fit.
  const room40 = Math.floor(Math.max(500, budget) * 0.4);
  if (typeof brief === "string" && brief.trim()) lines.push(brief.trim().length > room40 ? `${brief.trim().slice(0, room40).trimEnd()} … (more: rs show ${companyRecord(co)?.key})` : brief.trim());
  const decisions = records.list(co, { kind: "decision", limit: 5 });
  if (decisions.length) lines.push("Decisions (newest first):", ...decisions.map((r) => `- ${r.key} ${records.titleOf(co, r)}${typeof r.body.choice === "string" && r.body.choice ? ` → ${r.body.choice}` : ""}`));
  const goals = records.list(co, { kind: "goal", status: "active", limit: 8 }).sort((a, b) => (a.key < b.key ? -1 : 1));
  if (goals.length) lines.push("Active goals:", ...goals.map((r) => `- ${r.key} ${records.titleOf(co, r)}`));
  const projects = records.list(co, { kind: "project", status: "active", limit: 12 }).sort((a, b) => (a.key < b.key ? -1 : 1));
  if (projects.length) lines.push("Active projects:", ...projects.map((r) => `- ${r.key} ${records.titleOf(co, r)}${key(co, r.body.goal_id) ? ` (${key(co, r.body.goal_id)})` : ""}`));
  const open = openAssignments(co, agent ?? undefined).slice(0, 8);
  if (open.length) lines.push(agent ? "Your open assignments:" : "Open assignments:", ...open.map((r) => `- ${r.key} [${STATUS_WORDS[String(r.body.status ?? "queued")] ?? r.body.status}] ${records.titleOf(co, r)}`));
  lines.push("Write in clear English (the Curator checks agent text):", ...WRITING_RULES.map((r) => `- ${r}`));
  let text = lines.join("\n");
  const room = Math.max(500, budget) - STANDING.length - 60;
  if (text.length > room) text = `${text.slice(0, room).trimEnd()}\n(… trimmed; \`rs brief\` for the rest)`;
  return `${text}\n\n${STANDING}`;
}

export type JournalItem = { key: string; type: string; at: string; by: string; title: string; detail: unknown; action: unknown; amount: unknown; unit: unknown;
  about: { key: string; kind: string; title: string } | null; project: string | null; assignment: string | null;
  /** Old name of `assignment`, kept for readers written before schema 3. */
  work_order: string | null };

export function journalItems(co: Company, o: { type?: string | undefined; since?: string | undefined; limit?: number | undefined; project?: string | undefined } = {}): JournalItem[] {
  const project = o.project ? records.need(co, o.project).id : undefined;
  const where: Record<string, string> = {};
  if (project) where.project_id = project;
  if (o.type) where.type = o.type;
  return records.list(co, { kind: "entry", limit: 1000, where, since: o.since })
    .filter((r) => !o.since || r.created_at >= o.since)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, o.limit ?? 50)
    .map((r) => {
      const about = typeof r.body.about_id === "string" ? records.get(co, r.body.about_id) : undefined;
      return {
        key: r.key, type: String(r.body.type ?? "note"), at: r.created_at, by: r.updated_by, title: records.titleOf(co, r), detail: r.body.detail ?? r.body.text ?? null,
        action: r.body.action ?? null, amount: r.body.amount ?? null, unit: r.body.unit ?? null,
        about: about ? { key: about.key, kind: about.kind, title: records.titleOf(co, about) } : null,
        project: key(co, r.body.project_id), assignment: key(co, r.body.assignment_id), work_order: key(co, r.body.assignment_id),
      };
    });
}

export function activityItems(co: Company, since: string, limit: number) {
  return co.all<{ seq: number; at: string; actor: string; actor_kind: string; key: string; kind: string; title: string | null; op: string; changed: string; why: string | null }>(
    `select v.seq, v.at, v.actor, v.actor_kind, r.key, r.kind, f.title, v.op, v.changed, v.why
     from revisions v join records r on r.id = v.record_id left join records_fts f on f.id = r.id
     where v.at >= ? order by v.seq desc limit ?`, since, limit,
  ).map((x) => ({ ...x, title: x.title ?? x.key, changed: JSON.parse(x.changed) as string[] }));
}

/** A raw command or tool call logged as an action ("ads API: cd ~/x; cat > y.py <<EOF ..."): machine work, not news. */
export const isMachine = (title: string): boolean =>
  /(^|[\s;:])(cd|cat|grep|python3?|bash|curl|sed|ls|mkdir|export|source)\s|<<|\$\(|~\/|&&|\|\s*\w/.test(title);

/** Minutes of work in a list of times: gaps under 30 minutes count, longer gaps are breaks. */
function workedMinutes(times: string[]): number {
  const t = times.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < t.length; i++) { const gap = t[i]! - t[i - 1]!; if (gap < 30 * 60_000) ms += gap; }
  return Math.round(ms / 60_000);
}

export type Pulse = {
  slug: string; name: string; needs: number; last_at: string | null;
  agent: { name: string; last_seen: string | null; working: boolean } | null;
  focus: string | null;
  day: { entries: number; sessions: number; failed: number; minutes: number };
  week: number[];
  highlights: { key: string; type: string; at: string; by: string; title: string }[];
};

/** How a company is doing, in one read: what waits, whether its agent is working, what mattered, how much machine work. */
export function pulseOf(co: Company): Pulse {
  const now = Date.now(); const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  type Row = { key: string; at: string; by: string; type: string | null; title: string | null; project: string | null };
  const rows = co.all<Row>(`select key, created_at as at, updated_by as by, json_extract(body, '$.type') as type,
      coalesce(json_extract(body, '$.title'), json_extract(body, '$.text')) as title, json_extract(body, '$.project_id') as project
    from records where kind = 'entry' and archived = 0 and created_at >= ? order by created_at desc, id desc`, weekAgo);
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const day = rows.filter((r) => r.at >= dayAgo);
  const week = Array.from({ length: 7 }, () => 0);
  for (const r of rows) { const d = Math.floor((now - Date.parse(r.at)) / 86_400_000); if (d >= 0 && d < 7) week[6 - d]!++; }
  const meaningful = (r: Row) => r.type !== "session" && !!r.title && !(r.type === "action" && isMachine(r.title));
  const highlights = (day.some(meaningful) ? day : rows).filter(meaningful).slice(0, 5)
    .map((r) => ({ key: r.key, type: r.type ?? "note", at: r.at, by: r.by, title: r.title! }));
  const count = (sql: string, ...p: string[]) => co.one<{ n: number }>(sql, ...p)?.n ?? 0;
  const needs = count("select count(*) as n from records where archived = 0 and kind in ('request', 'flag') and json_extract(body, '$.status') = 'open'")
    + count("select count(*) as n from records where archived = 0 and kind = 'assignment' and json_extract(body, '$.status') = 'needs_permission'");
  const seen = co.one<{ agent: string; at: string }>("select agent, at from presence order by at desc limit 1");
  const lastAgent = rows.find((r) => r.by.startsWith("hermes:") || r.by.startsWith("agent:"));
  const agentName = seen?.agent ?? lastAgent?.by ?? null;
  const lastSeen = [seen?.at, lastAgent?.at].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const running = openAssignments(co).find((r) => ["picked_up", "in_progress", "running"].includes(String(r.body.status)));
  const projects = new Map<string, number>();
  for (const r of day) if (r.project) projects.set(r.project, (projects.get(r.project) ?? 0) + 1);
  const topProject = [...projects.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const focusRec = topProject ? records.get(co, topProject) : undefined;
  return {
    slug: co.slug, name: co.name, needs, last_at: rows[0]?.at ?? co.one<{ at: string | null }>("select max(created_at) as at from records where kind = 'entry'")?.at ?? null,
    agent: agentName ? { name: agentName, last_seen: lastSeen, working: !!lastSeen && now - Date.parse(lastSeen) < 15 * 60_000 } : null,
    focus: running ? String(running.body.title ?? running.key) : focusRec ? records.titleOf(co, focusRec) : null,
    day: { entries: day.length, sessions: day.filter((r) => r.type === "session").length,
      failed: day.filter((r) => r.type === "session" && / failed\b/.test(r.title ?? "")).length, minutes: workedMinutes(day.map((r) => r.at)) },
    week, highlights,
  };
}

export const viewOperations: Operation[] = [
  op({
    name: "pulse.get", summary: "How the company is doing: what waits, whether its agent is working, what mattered lately, how much machine work", role: "viewer", write: false,
    input: Type.Object({}),
    run: (ctx) => pulseOf(ctx.company),
  }),
  op({
    name: "brief.get", summary: "The short company brief an agent reads at the start of a session", role: "viewer", write: false,
    input: Type.Object({ budget: Type.Optional(Type.Integer({ minimum: 500, maximum: 20000, description: "Most characters to return" })) }),
    run: (ctx, i) => ({ text: briefText(ctx.company, ctx.actor.kind === "agent" ? ctx.actor.name : null, i.budget), actor: ctx.actor, company: ctx.company.slug }),
  }),
  op({
    name: "journal.log", summary: "Write a Journal entry: what changed or is now true (outcome), or a note", role: "member", write: true,
    input: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 300, description: "What happened, in one line" }),
      type: Type.Optional(Type.Union([Type.Literal("outcome"), Type.Literal("note")], { description: "outcome (default) or note" })),
      detail: Type.Optional(Type.String({ maxLength: 8000 })),
      about: Type.Optional(Type.String({ description: "The record this is about (key or id)" })), project: Type.Optional(Type.String({ description: "The project it moves (key or id)" })),
    }),
    run: (ctx, i) => {
      const extra: records.Body = {};
      if (i.detail) extra.detail = i.detail;
      if (i.project) extra.project_id = i.project;
      return records.logEntry(ctx.company, who(ctx), i.type ?? "outcome", i.title, i.about ? records.need(ctx.company, i.about) : null, meta(ctx), extra);
    },
  }),
  op({
    name: "journal.list", summary: "The Journal, newest first: what happened (outcomes, outward actions, sessions, notes)", role: "viewer", write: false,
    input: Type.Object({
      type: Type.Optional(Type.Union(ENTRY_TYPES.map((t) => Type.Literal(t)))), since: Type.Optional(Type.String({ description: "\"24h\", \"7d\" or an ISO time" })),
      project: Type.Optional(Type.String()), limit: Limit(500),
    }),
    run: (ctx, i) => journalItems(ctx.company, { type: i.type, since: i.since ? sinceTime(i.since, 24) : undefined, limit: i.limit, project: i.project }),
  }),
  op({
    name: "activity.list", summary: "Every change in the company, newest first, with who made it", role: "viewer", write: false,
    input: Type.Object({ since: Type.Optional(Type.String({ description: "\"24h\" (default), \"7d\" or an ISO time" })), limit: Limit(1000) }),
    run: (ctx, i) => activityItems(ctx.company, sinceTime(i.since, 24), i.limit ?? 200),
  }),
  op({
    name: "today.get", summary: "Today: what needs a person, what got done, what is in progress", role: "viewer", write: false,
    input: Type.Object({}),
    run: (ctx) => {
      const co = ctx.company; const day = sinceTime("24h", 24); const all = records.list(co, { kind: "assignment", limit: 1000 });
      return {
        needs_you: all.filter((r) => r.body.status === "needs_permission" || (r.body.status === "failed" && r.updated_at >= sinceTime("7d", 168))).map((r) => assignmentOf(co, r)),
        results: journalItems(co, { type: "outcome", since: day, limit: 50 }),
        actions: journalItems(co, { type: "action", since: day, limit: 50 }).map((e) => ({ key: e.key, at: e.at, by: e.by, action: e.action, detail: e.title, amount: e.amount, unit: e.unit })),
        open_work: openAssignments(co).map((r) => assignmentOf(co, r)),
      };
    },
  }),
  op({
    name: "company.get", summary: "This company: its name, brief, and how many records of each kind", role: "viewer", write: false,
    input: Type.Object({}),
    run: (ctx) => {
      const co = ctx.company; const rec = companyRecord(co);
      return {
        slug: co.slug, name: co.name, key: rec?.key ?? null, brief: typeof rec?.body.brief === "string" ? rec.body.brief : "",
        kinds: co.all<{ kind: string; live: number; archived: number }>("select kind, sum(archived = 0) as live, sum(archived = 1) as archived from records group by kind order by kind"),
        last_seq: co.one<{ n: number | null }>("select max(seq) as n from revisions")?.n ?? 0,
      };
    },
  }),
  op({
    name: "company.update", summary: "Change the company brief that agents read first", role: "admin", write: true,
    input: Type.Object({ brief: Type.String({ maxLength: 12000 }) }),
    run: (ctx, i) => {
      const rec = companyRecord(ctx.company);
      return rec ? records.patch(ctx.company, who(ctx), rec.id, { brief: i.brief }, meta(ctx))
        : records.create(ctx.company, who(ctx), "company", { name: ctx.company.name, brief: i.brief }, meta(ctx));
    },
  }),
];
