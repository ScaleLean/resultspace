#!/usr/bin/env node
// `rs`: the ResultSpace command line for people and agents. A thin client: every command is one or two
// calls to the server's operations. No local copy, no sync.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Rec, Revision, Hit, Link } from "../core/records.ts";
import type { KindDef } from "../core/schema.ts";
import type { JournalItem } from "../operations/views.ts";
import type { SkillItem } from "../operations/skills.ts";
import type { Assignment } from "../operations/assignments.ts";
import { intFlag, parseArgs, parseFields, type Args } from "./args.ts";
import { call, me } from "./client.ts";
import { CliError, configPath, loadConfig, parseToml, pickCompany, profileName, readKey, usage, type Config } from "./config.ts";
import { pairs, table, titleOf } from "./format.ts";
import { HELP, TOPICS } from "./help.ts";

// `notice`: a line for a person, printed to stderr and only without --json (scripts that read JSON never see it).
type Out = { data: unknown; text: string; warnings?: string[]; notice?: string };
type Cmd = (a: Args, cfg: Config, slug: string) => Promise<Out>;

/** The record shape `rs --json` has always printed. */
const shape = (r: Rec, slug: string) => ({
  id: r.id, key: r.key, company_id: slug, kind: r.kind, title: titleOf(r.body, r.key), status: typeof r.body.status === "string" ? r.body.status : null,
  rev: r.rev, sync_state: "synced", pending_ops: 0, archived: r.archived, body: r.body, conflict: null,
});
const need = (a: Args, n: number, what: string): string => {
  const w = a.words[n];
  if (!w) throw usage(`missing ${what}`);
  return w;
};
const assignmentLine = (o: Assignment) => ({ key: o.key, status: o.status_words, owner: o.owner, title: o.title });
// A reported result is the agent's word: say so next to it, and whether a person verified it.
const verified = (o: Assignment) => (!o.verification ? null : o.verification.state === "not_verified" ? (o.result ? "not verified" : null) : `${o.verification.state} by ${o.verification.by ?? "?"}${o.verification.note ? `: ${o.verification.note}` : ""}`);
const showAssignment = (o: Assignment) =>
  pairs({ key: o.key, title: o.title, owner: o.owner, status: o.status_words, project: o.project, due: o.due_on, brief: o.brief, progress: o.progress, answer: o.answer,
    reported: o.result, reported_by: o.reported_by, verification: verified(o) }, 2000);
const RENAMED = "note: `rs work` is now `rs assignment` (work orders are assignments). `rs work` keeps working for now; see rs help assignments.";

// The old kinds that are Journal entries now: `rs ls note` and `rs new note` keep working.
const OLD_KINDS: Record<string, string> = { note: "note", result: "outcome", action: "action", receipt: "session" };
const kindOf = (name: string): { kind: string; type?: string } => (OLD_KINDS[name] ? { kind: "entry", type: OLD_KINDS[name] } : { kind: name });

const commands: Record<string, Cmd> = {
  async ls(a, cfg, slug) {
    const asked = need(a, 0, "a kind: rs ls task");
    const { kind, type } = kindOf(asked);
    const where = { ...(type ? { type } : {}), ...parseFields(a.words.slice(1)) } as Record<string, string>;
    const recs = await call<Rec[]>(cfg, slug, "record.list", {
      kind, ...(a.flags.status ? { status: a.flags.status } : {}), ...(Object.keys(where).length ? { where } : {}),
      ...(a.bools.has("archived") ? { archived: true } : a.bools.has("all") ? { archived: "all" } : {}), limit: intFlag(a, "limit") ?? 200,
    });
    const records = recs.map((r) => shape(r, slug));
    return { data: { company_id: slug, kind: asked, records }, text: table(records, ["key", "title", "status"]) };
  },
  async show(a, cfg, slug) {
    const r = shape(await call<Rec>(cfg, slug, "record.get", { ref: need(a, 0, "a record key: rs show TSK-0007") }), slug);
    return { data: { custom: [], record: r }, text: `${pairs({ key: r.key, id: r.id, kind: r.kind, company: slug, rev: r.rev, archived: r.archived })}\n\n${pairs(r.body, 2000)}` };
  },
  async new(a, cfg, slug) {
    const { kind, type } = kindOf(need(a, 0, "a kind: rs new task title=\"Call supplier\""));
    let body = { ...(type ? { type } : {}), ...parseFields(a.words.slice(1)) };
    if (a.flags.body) {
      try { body = { ...(type ? { type } : {}), ...(JSON.parse(a.flags.body) as Record<string, unknown>), ...body }; } catch { throw usage("--body needs a JSON object"); }
    }
    const r = shape(await call<Rec>(cfg, slug, "record.create", { kind, body, ...(a.flags.result ? { result: a.flags.result } : {}), ...(a.flags.why ? { why: a.flags.why } : {}) }, true), slug);
    return { data: { key: r.key, id: r.id, record: r }, text: `created ${r.key}  ${r.title}` };
  },
  async set(a, cfg, slug) {
    const ref = need(a, 0, "a record key: rs set TSK-0007 status=done");
    const set = parseFields(a.words.slice(1));
    if (!Object.keys(set).length && !a.flags.result) throw usage("nothing to set: rs set TSK-0007 status=done");
    const baseRev = intFlag(a, "base-rev");
    const r = shape(await call<Rec>(cfg, slug, "record.patch", { ref, set, ...(baseRev ? { base_rev: baseRev } : {}), ...(a.flags.result ? { result: a.flags.result } : {}), ...(a.flags.why ? { why: a.flags.why } : {}) }, true), slug);
    return { data: { key: r.key, rev: r.rev, record: r }, text: `saved ${r.key} (revision ${r.rev})` };
  },
  async archive(a, cfg, slug) {
    const r = shape(await call<Rec>(cfg, slug, "record.archive", { ref: need(a, 0, "a record key") }, true), slug);
    return { data: { key: r.key, record: r }, text: `archived ${r.key}` };
  },
  async restore(a, cfg, slug) {
    const r = shape(await call<Rec>(cfg, slug, "record.restore", { ref: need(a, 0, "a record key") }, true), slug);
    return { data: { key: r.key, record: r }, text: `restored ${r.key}` };
  },
  async search(a, cfg, slug) {
    const hits = await call<Hit[]>(cfg, slug, "record.search", { q: need(a, 0, "search words"), ...(a.flags.kind ? { kind: a.flags.kind } : {}), limit: intFlag(a, "limit") ?? 20 });
    return { data: { query: a.words[0], hits }, text: hits.length ? hits.map((h) => `${h.key}  ${h.title}\n    ${h.snippet}`).join("\n") : "Not on record." };
  },
  async history(a, cfg, slug) {
    const revisions = await call<Revision[]>(cfg, slug, "record.history", { ref: need(a, 0, "a record key") });
    return { data: { revisions }, text: table(revisions.map((v) => ({ rev: v.rev, at: v.at, by: v.actor, op: v.op, changed: v.changed.join(", "), why: v.why })), ["rev", "at", "by", "op", "changed", "why"]) };
  },
  async context(a, cfg, slug) {
    const c = await call<{ record: Rec; links: { out: Link[]; in: Link[] }; history: unknown[] }>(cfg, slug, "record.context", { ref: need(a, 0, "a record key") });
    const link = (l: Link) => `  ${l.label}: ${l.key}  ${l.title}`;
    return { data: { ...c, record: shape(c.record, slug) }, text: [`${c.record.key}  ${titleOf(c.record.body, c.record.key)}`, pairs(c.record.body, 2000), "Points at:", ...c.links.out.map(link), "Pointed at by:", ...c.links.in.map(link)].join("\n") };
  },
  async activity(a, cfg, slug) {
    const items = await call<Record<string, unknown>[]>(cfg, slug, "activity.list", { ...(a.flags.since ? { since: a.flags.since } : {}), limit: intFlag(a, "limit") ?? 100 });
    return { data: { items }, text: table(items, ["at", "actor", "key", "op", "title"]) };
  },
  async journal(a, cfg, slug) {
    const items = await call<JournalItem[]>(cfg, slug, "journal.list", { ...(a.flags.type ? { type: a.flags.type } : {}), ...(a.flags.since ? { since: a.flags.since } : {}), ...(a.flags.project ? { project: a.flags.project } : {}), limit: intFlag(a, "limit") ?? 50 });
    return { data: { items }, text: table(items.map((e) => ({ at: e.at.slice(0, 16), type: e.type, by: e.by, project: e.project, entry: e.title })), ["at", "type", "by", "project", "entry"]) };
  },
  async log(a, cfg, slug) {
    const title = need(a, 0, "what happened: rs log \"Label shipped to the printer\"");
    const e = shape(await call<Rec>(cfg, slug, "journal.log", { title, ...(a.flags.type ? { type: a.flags.type } : {}), ...(a.flags.text ? { detail: a.flags.text } : {}), ...(a.flags.about ? { about: a.flags.about } : {}), ...(a.flags.project ? { project: a.flags.project } : {}) }, true), slug);
    return { data: { key: e.key, id: e.id, record: e }, text: `logged ${e.key}  ${e.title}` };
  },
  async today(_a, cfg, slug) {
    const t = await call<{ needs_you: Assignment[]; results: JournalItem[]; actions: Record<string, unknown>[]; open_work: Assignment[] }>(cfg, slug, "today.get");
    return { data: t, text: [`Needs you (${t.needs_you.length})`, table(t.needs_you.map(assignmentLine), ["key", "status", "owner", "title"]), "", "Reported results, last 24 hours",
      table(t.results.map((r) => ({ by: r.by, project: r.project, result: r.title })), ["by", "project", "result"]), "", "Outward actions, last 24 hours", table(t.actions, ["by", "action", "detail"]),
      "", "Open assignments", table(t.open_work.map(assignmentLine), ["key", "status", "owner", "title"])].join("\n") };
  },
  async brief(a, cfg, slug) {
    const b = await call<{ text: string }>(cfg, slug, "brief.get", { ...(intFlag(a, "budget") ? { budget: intFlag(a, "budget") } : {}) });
    return { data: b, text: b.text };
  },
  async assignment(a, cfg, slug) {
    const sub = a.words[0] ?? "ls"; const ref = () => need(a, 1, "an assignment key: rs assignment show ASG-0001");
    const flag = (name: string, what: string) => { const v = a.flags[name]; if (!v) throw usage(`rs assignment ${sub} needs --${name} "${what}"`); return v; };
    if (sub === "ls" || sub === "list") {
      const assignments = await call<Assignment[]>(cfg, slug, "assignment.list", { ...(a.bools.has("all") ? { all: true } : {}), ...(a.flags.owner ? { owner: a.flags.owner } : {}), ...(a.flags.project ? { project: a.flags.project } : {}) });
      return { data: { assignments }, text: table(assignments.map(assignmentLine), ["key", "status", "owner", "title"], "No open assignments.") };
    }
    if (sub === "next") {
      const n = await call<{ assignment: Assignment | null; claimed?: boolean }>(cfg, slug, "assignment.next", {}, true);
      return { data: n, text: n.assignment ? `${showAssignment(n.assignment)}\n\nIt is yours. Start: rs assignment start ${n.assignment.key}. Finish: rs assignment report ${n.assignment.key} --result "outcome"` : "No assignment is waiting for you." };
    }
    const ops: Record<string, [string, () => Record<string, unknown>]> = {
      show: ["assignment.show", () => ({})], claim: ["assignment.claim", () => ({})], start: ["assignment.start", () => (a.flags.progress ? { progress: a.flags.progress } : {})],
      report: ["assignment.report", () => ({ result: flag("result", "the outcome") })], fail: ["assignment.fail", () => ({ result: flag("result", "why it could not be finished") })],
      "need-permission": ["assignment.need_permission", () => ({ detail: a.flags.detail ?? flag("detail", "what a person must decide") })],
      answer: ["assignment.answer", () => ({ answer: flag("answer", "your decision") })], cancel: ["assignment.cancel", () => (a.flags.why ? { why: a.flags.why } : {})],
      verify: ["assignment.verify", () => ({ verdict: a.bools.has("disputed") ? "disputed" : "verified", ...(a.flags.note ? { note: a.flags.note } : {}) })],
    };
    const o = ops[sub];
    if (!o) throw usage(`unknown: rs assignment ${sub}. Use ls | next | claim | show | start | report | fail | need-permission | answer | cancel | verify`);
    const assignment = await call<Assignment>(cfg, slug, o[0], { ref: ref(), ...o[1]() }, sub !== "show");
    return { data: { assignment }, text: showAssignment(assignment) };
  },
  // The old name of `rs assignment`, kept with its old JSON shapes (work_orders, work_order) and its old
  // operations (work.*), so scripts and HUDs that read it keep working against an old or a new server.
  async work(a, cfg, slug) {
    const sub = a.words[0] ?? "ls"; const ref = () => need(a, 1, "a work order key: rs work show WO-0001");
    const result = () => { if (!a.flags.result) throw usage(`rs work ${sub} needs --result "the outcome"`); return a.flags.result; };
    if (sub === "ls" || sub === "list") {
      const work_orders = await call<Assignment[]>(cfg, slug, "work.list", { ...(a.bools.has("all") ? { all: true } : {}), ...(a.flags.owner ? { owner: a.flags.owner } : {}) });
      return { data: { work_orders }, text: table(work_orders.map(assignmentLine), ["key", "status", "owner", "title"], "No open work orders."), notice: RENAMED };
    }
    if (sub === "next") {
      const n = await call<{ work_order: Assignment | null }>(cfg, slug, "work.next", {}, true);
      return { data: n, text: n.work_order ? `${showAssignment(n.work_order)}\n\nIt is yours. Start: rs work start ${n.work_order.key}. Finish: rs work report ${n.work_order.key} --result "outcome"` : "No work order is waiting for you.", notice: RENAMED };
    }
    const ops: Record<string, [string, () => Record<string, unknown>]> = {
      show: ["work.show", () => ({})], start: ["work.start", () => (a.flags.progress ? { progress: a.flags.progress } : {})],
      report: ["work.report", () => ({ result: result() })], fail: ["work.fail", () => ({ result: result() })],
      "need-permission": ["work.need_permission", () => ({ detail: a.flags.detail ?? result() })],
    };
    const o = ops[sub];
    if (!o) throw usage(`unknown: rs work ${sub}. Use ls | next | show | start | report | fail | need-permission (or rs assignment)`);
    const order = await call<Assignment>(cfg, slug, o[0], { ref: ref(), ...o[1]() }, sub !== "show");
    return { data: { work_order: order }, text: showAssignment(order), notice: RENAMED };
  },
  async act(a, cfg, slug) {
    const action = need(a, 0, "an action: rs act publish --detail \"what you did\"");
    if (!a.flags.detail) throw usage("say what you did in --detail (it is what a person reads)");
    // --assignment (or --asg); --wo is the old name and still sends the old field, so an old server links it too.
    const under = a.flags.assignment ?? a.flags.asg;
    if (under && a.flags.wo && under !== a.flags.wo) throw usage("--wo is the old name of --assignment: give one of them");
    const amount = a.flags.amount === undefined ? undefined : Number(a.flags.amount);
    if (amount !== undefined && Number.isNaN(amount)) throw usage("--amount needs a number");
    const r = await call<{ decision: string; reason: string; key: string }>(cfg, slug, "action.record",
      { action, detail: a.flags.detail, ...(amount === undefined ? {} : { amount }), ...(a.flags.unit ? { unit: a.flags.unit } : {}), ...(under ? { assignment: under } : a.flags.wo ? { work_order: a.flags.wo } : {}) }, true);
    return { data: r, text: `recorded ${r.key}: ${action}` };
  },
  async task(a, cfg, slug) {
    const sub = need(a, 0, "add | done | attach");
    if (sub === "add") {
      const body = { title: need(a, 1, "a title: rs task add \"Call supplier\""), status: "todo", ...(a.flags.project ? { project_id: a.flags.project } : {}), ...parseFields(a.words.slice(2)) };
      const r = shape(await call<Rec>(cfg, slug, "record.create", { kind: "task", body }, true), slug);
      return { data: { key: r.key, id: r.id, record: r }, text: `created ${r.key}  ${r.title}` };
    }
    if (sub === "done") {
      const r = shape(await call<Rec>(cfg, slug, "record.patch", { ref: need(a, 1, "a task key"), set: { status: "done" }, ...(a.flags.result ? { result: a.flags.result } : {}) }, true), slug);
      return { data: { key: r.key, rev: r.rev, record: r }, text: `done ${r.key}` };
    }
    if (sub === "attach") {
      const ref = need(a, 1, "a task key"); const file = need(a, 2, "a file path");
      if (!existsSync(file)) throw usage(`no file ${file}`);
      const blob = await call<{ sha256: string; size: number }>(cfg, slug, "blob.put", { b64: readFileSync(file).toString("base64") }, true);
      const art = await call<Rec>(cfg, slug, "record.create", { kind: "artifact", body: { title: basename(file), filename: basename(file), sha256: blob.sha256, size: blob.size } }, true);
      const task = await call<Rec>(cfg, slug, "record.get", { ref });
      const ids = Array.isArray(task.body.artifact_ids) ? (task.body.artifact_ids as unknown[]) : [];
      await call<Rec>(cfg, slug, "record.patch", { ref, set: { artifact_ids: [...ids, art.id] } }, true);
      return { data: { key: task.key, artifact: art.key, sha256: blob.sha256 }, text: `attached ${basename(file)} to ${task.key} as ${art.key}` };
    }
    throw usage(`unknown: rs task ${sub}. Use add | done | attach`);
  },
  async note(a, cfg, slug) {
    if (need(a, 0, "add") !== "add") throw usage("use: rs note add \"title\" --text \"...\"");
    const e = shape(await call<Rec>(cfg, slug, "journal.log", { type: "note", title: need(a, 1, "a title"), ...(a.flags.text ? { detail: a.flags.text } : {}), ...(a.flags.project ? { project: a.flags.project } : {}) }, true), slug);
    if (a.flags.result) await call(cfg, slug, "journal.log", { title: a.flags.result, about: e.key }, true);
    return { data: { key: e.key, id: e.id, record: e }, text: `noted ${e.key}  ${e.title}` };
  },
  async skills(a, cfg, slug) {
    const sub = a.words[0] ?? "ls";
    if (sub === "show") {
      const s = await call<{ key: string; company: string; shared: boolean; markdown: string }>(cfg, slug, "skill.show", { ref: need(a, 1, "a skill key: rs skills show SKL-0001"), ...(a.bools.has("shared") ? { shared: true } : {}) });
      return { data: s, text: s.markdown };
    }
    if (sub === "sync") {
      const dir = a.words[1] ?? join(process.env.HERMES_HOME ?? join(homedir(), ".hermes"), "skills", "resultspace");
      const list = await call<SkillItem[]>(cfg, slug, "skill.list", { status: "active" });
      const written: string[] = [];
      for (const sk of list) {
        const s = await call<{ markdown: string }>(cfg, slug, "skill.show", { ref: sk.key, shared: sk.shared });
        const d = join(dir, `${sk.shared ? "shared" : slug}-${sk.key.toLowerCase()}`);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "SKILL.md"), s.markdown);
        written.push(d);
      }
      return { data: { dir, written }, text: written.length ? `wrote ${written.length} skill(s) under ${dir}` : `no active skills to write (${dir})` };
    }
    if (sub !== "ls" && sub !== "list") throw usage(`unknown: rs skills ${sub}. Use ls [--search words] | show KEY [--shared] | sync [DIR]`);
    const skills = await call<SkillItem[]>(cfg, slug, "skill.list", { ...(a.flags.search ? { q: a.flags.search } : {}), ...(a.flags.status ? { status: a.flags.status } : {}) });
    return { data: { skills }, text: table(skills.map((s) => ({ key: s.key, status: s.status, from: s.shared ? "shared" : s.company, title: s.title, when: s.when })), ["key", "status", "from", "title", "when"], "No skills yet. Create one: rs new skill title=\"...\" when=\"...\" body=\"...\" status=active") };
  },
  async knowledge(a, cfg, slug) {
    const collection = a.words[0];
    if (collection === "health") {
      const all = await call<Rec[]>(cfg, slug, "record.list", { kind: "knowledge", limit: 1000 });
      const n = all.length; const pct = (k: number) => (n ? Math.round((100 * k) / n) : 0);
      const health = { pages: n, sourced_pct: pct(all.filter((r) => Array.isArray(r.body.source_ids) ? r.body.source_ids.length : r.body.source || r.body.url).length), verified_pct: pct(all.filter((r) => r.body.verification === "verified").length) };
      return { data: health, text: `Knowledge: ${n} pages, ${health.sourced_pct}% sourced, ${health.verified_pct}% verified` };
    }
    if (a.flags.search) {
      const hits = (await call<Hit[]>(cfg, slug, "record.search", { q: a.flags.search, kind: "knowledge", limit: intFlag(a, "limit") ?? 20 }));
      return { data: { hits }, text: hits.length ? hits.map((h) => `${h.key}  ${h.title}\n    ${h.snippet}`).join("\n") : "Not on record." };
    }
    const recs = await call<Rec[]>(cfg, slug, "record.list", { kind: "knowledge", ...(collection ? { where: { collection } } : {}), limit: intFlag(a, "limit") ?? 200 });
    const records = recs.map((r) => shape(r, slug));
    return { data: { company_id: slug, kind: "knowledge", records }, text: table(records.map((r) => ({ key: r.key, collection: r.body.collection, title: r.title })), ["key", "collection", "title"]) };
  },
  async plans(_a, cfg, slug) {
    const [goals, projects] = await Promise.all([call<Rec[]>(cfg, slug, "record.list", { kind: "goal" }), call<Rec[]>(cfg, slug, "record.list", { kind: "project" })]);
    const keyOf = new Map(goals.map((g) => [g.id, g.key]));
    const rows = (rs: Rec[]) => rs.map((r) => ({ key: r.key, status: r.body.status, goal: keyOf.get(String(r.body.goal_id)) ?? "", title: titleOf(r.body, r.key) }));
    return { data: { goals: goals.map((g) => shape(g, slug)), projects: projects.map((p) => shape(p, slug)) }, text: `Goals\n${table(rows(goals), ["key", "status", "title"])}\n\nProjects\n${table(rows(projects), ["key", "status", "goal", "title"])}` };
  },
  async goal(a, cfg, slug) {
    const set: Record<string, unknown> = {};
    if (a.flags.now !== undefined) set.current = Number(a.flags.now);
    if (a.flags.target !== undefined) set.target = Number(a.flags.target);
    if (!Object.keys(set).length || Object.values(set).some((v) => Number.isNaN(v))) throw usage("use: rs goal GOAL-0001 --now 40 --target 100");
    const r = shape(await call<Rec>(cfg, slug, "record.patch", { ref: need(a, 0, "a goal key"), set }, true), slug);
    return { data: { key: r.key, rev: r.rev, record: r }, text: `saved ${r.key}` };
  },
  async perms(_a, cfg, slug) {
    const [actions, recorded] = await Promise.all([call<unknown[]>(cfg, slug, "action.kinds"), call<Rec[]>(cfg, slug, "record.list", { kind: "action", limit: 50 })]);
    const rows = recorded.map((r) => ({ key: r.key, at: r.created_at, by: r.updated_by, action: r.body.action, detail: r.body.title }));
    return { data: { actions, recorded: rows, asks: [] }, text: `ResultSpace does not ask before outward actions. It records them.\n\n${table(rows, ["at", "by", "action", "detail"])}` };
  },
  async kinds(a, cfg, slug) {
    if (a.words[0] === "define") {
      const k = await call<KindDef>(cfg, slug, "kind.define", {
        kind: need(a, 1, "a kind name"), prefix: a.flags.prefix ?? usageNow("--prefix is needed: rs kinds define formula --prefix FRM"),
        ...(a.flags["title-field"] ? { title_field: a.flags["title-field"] } : {}), ...(a.flags.statuses ? { statuses: a.flags.statuses.split(",").map((s) => s.trim()) } : {}),
      }, true);
      return { data: k, text: `kind ${k.kind} (${k.prefix})` };
    }
    const kinds = await call<KindDef[]>(cfg, slug, "kind.list");
    return { data: { kinds }, text: table(kinds.map((k) => ({ kind: k.kind, prefix: k.prefix, title: k.title_field, statuses: k.statuses?.join(", ") ?? "" })), ["kind", "prefix", "title", "statuses"]) };
  },
  async agents(a, cfg, slug) {
    const sub = a.words[0] ?? "ls";
    if (sub === "ls") {
      const agents = await call<Record<string, unknown>[]>(cfg, slug, "agent.list");
      return { data: { agents }, text: table(agents, ["name", "role", "active", "last_seen"]) };
    }
    const name = need(a, 1, "an agent name");
    if (sub === "add") { await call(cfg, slug, "agent.add", { name, ...(a.flags.role ? { role: a.flags.role } : {}) }, true); return { data: { agent: name }, text: `added ${name}` }; }
    if (sub === "revoke") { await call(cfg, slug, "agent.revoke", { name }, true); return { data: { agent: name }, text: `revoked every key of ${name}` }; }
    if (sub === "key") {
      if (!a.flags.out) throw usage("say where to write the key: rs agents key NAME --out FILE (the key is never printed)");
      const k = await call<{ key: string }>(cfg, slug, "agent.key", { name });
      writeFileSync(a.flags.out, `${k.key}\n`, { mode: 0o600, flag: "wx" });
      return { data: { agent: name, key_file: a.flags.out }, text: `key for ${name} written to ${a.flags.out}` };
    }
    throw usage(`unknown: rs agents ${sub}. Use ls | add | key | revoke`);
  },
  async blob(a, cfg, slug) {
    if (need(a, 0, "get") !== "get" || !a.flags.out) throw usage("use: rs blob get SHA256 --out FILE");
    const b = await call<{ sha256: string; size: number; b64: string }>(cfg, slug, "blob.get", { sha256: need(a, 1, "a sha256") });
    writeFileSync(a.flags.out, Buffer.from(b.b64, "base64"));
    return { data: { sha256: b.sha256, size: b.size, out: a.flags.out }, text: `wrote ${b.size} bytes to ${a.flags.out}` };
  },
  async status(_a, cfg, slug) {
    const c = await call<{ kinds: { kind: string; live: number; archived: number }[]; last_seq: number }>(cfg, slug, "company.get");
    return { data: { profile: cfg.profile, server: cfg.server_url, company: slug, ...c }, text: `profile  ${cfg.profile}\nserver   ${cfg.server_url}\ncompany  ${slug}\n\n${table(c.kinds, ["kind", "live", "archived"])}` };
  },
};
const usageNow = (m: string): never => { throw usage(m); };
const ALIAS: Record<string, string> = { list: "ls", get: "show", create: "new", edit: "set", ask: "search", results: "journal", assignments: "assignment", asg: "assignment" };

// Commands that speak for the whole profile, not one company.
async function whoami(cfg: Config, only?: string): Promise<Out> {
  const slugs = only ? [pickCompany(cfg, only)] : Object.keys(cfg.companies);
  const all = await Promise.all(slugs.map((s) => me(cfg, s)));
  const companies = all.map((m) => ({ id: m.company.slug, slug: m.company.slug, name: m.company.name, role: m.actor.role, modules: [] }));
  const actor = { kind: all[0]!.actor.kind, name: all[0]!.actor.name };
  return { data: { actor, auth: { method: "agent_key" }, companies, profile: cfg.profile, server: cfg.server_url, version: all[0]!.version },
    text: `actor    ${actor.name}\nkind     ${actor.kind}\nprofile  ${cfg.profile}\nserver   ${cfg.server_url}\n\n${table(companies, ["slug", "name", "role"])}` };
}

/** Write (or extend) this profile's cli.toml: rs init --server URL --company SLUG --key-file FILE */
function init(a: Args): Out {
  const slug = a.flags.company; const keyFile = a.flags["key-file"];
  if (!slug || !keyFile) throw usage("use: rs init --server http://127.0.0.1:4390 --company acme --key-file ~/.config/resultspace/keys/acme.key");
  const path = configPath(profileName(a.flags.profile));
  const cur = existsSync(path) ? parseToml(readFileSync(path, "utf8")) : {};
  const top = cur[""] ?? {};
  const server = a.flags.server ?? top.server_url;
  if (!server) throw usage("--server is needed the first time");
  const companies: Record<string, string> = {};
  for (const [t, v] of Object.entries(cur)) { const m = /^companies\.(.+)$/.exec(t); if (m?.[1] && v.key_file) companies[m[1]] = v.key_file; }
  companies[slug] = keyFile.replace(/^~(?=\/)/, homedir());
  if (!existsSync(companies[slug])) throw usage(`no key file at ${companies[slug]} (make one in Admin, or with: node src/admin.ts agent key ${slug} NAME --out FILE)`);
  const lines = [`server_url = "${server.replace(/\/+$/, "")}"`, `default_company = "${a.bools.has("default") || !top.default_company ? slug : top.default_company}"`];
  for (const [c, f] of Object.entries(companies)) lines.push(`[companies.${c}]`, `key_file = "${f}"`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  return { data: { path, server, companies: Object.keys(companies) }, text: `wrote ${path}: ${server}, companies ${Object.keys(companies).join(", ")}. Check it: rs doctor` };
}

async function doctor(profile?: string): Promise<Out> {
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const add = (check: string, ok: boolean, detail = "") => checks.push({ check, ok, detail });
  let cfg: Config | undefined;
  try { cfg = loadConfig(profile); add("config", true, cfg.path); } catch (e) { add("config", false, e instanceof Error ? e.message : String(e)); }
  if (cfg) {
    try { const r = await fetch(`${cfg.server_url}/health`, { signal: AbortSignal.timeout(10_000) }); add("server", r.ok, `${cfg.server_url} answered ${r.status}`); }
    catch (e) { add("server", false, `cannot reach ${cfg.server_url}: ${e instanceof Error ? e.message : String(e)}`); }
    for (const slug of Object.keys(cfg.companies)) {
      try { readKey(cfg, slug); const m = await me(cfg, slug); add(`key ${slug}`, true, `${m.actor.name} (${m.actor.role})`); }
      catch (e) { add(`key ${slug}`, false, e instanceof Error ? e.message : String(e)); }
    }
    if (cfg.default_company && !cfg.companies[cfg.default_company]) add("default company", false, `${cfg.default_company} has no key`);
  }
  const ok = checks.every((c) => c.ok);
  if (!ok) process.exitCode = 1;
  return { data: { ok, checks }, text: `${table(checks.map((c) => ({ check: c.check, result: c.ok ? "ok" : "FAIL", detail: c.detail })), ["check", "result", "detail"])}\n\n${ok ? "All good." : "Something needs fixing (see FAIL)."}` };
}

async function main(argv: string[]): Promise<{ command: string; out: Out }> {
  const a = parseArgs(argv);
  const name = a.words.shift() ?? "help";
  const command = ALIAS[name] ?? name;
  if (command === "help" || a.bools.has("help")) { const topic = command === "help" ? a.words[0] : command; return { command: "help", out: { data: { topics: Object.keys(TOPICS) }, text: (topic && TOPICS[topic]) || HELP } }; }
  if (command === "doctor") return { command, out: await doctor(a.flags.profile) };
  if (command === "init") return { command, out: init(a) };
  if (command === "sync" || command === "conflicts" || command === "resolve" || command === "login")
    return { command, out: { data: { needed: false }, text: `\`rs ${command}\` is not needed any more: rs talks to the server directly and keeps no local copy.` } };
  const cfg = loadConfig(a.flags.profile);
  if (command === "whoami") return { command, out: await whoami(cfg, a.flags.company) };
  if (command === "companies") { const w = await whoami(cfg); const companies = (w.data as { companies: Record<string, unknown>[] }).companies; return { command, out: { data: { companies }, text: table(companies, ["slug", "name", "role"]) } }; }
  const cmd = commands[command];
  if (!cmd) throw usage(`unknown command: rs ${name}. See rs help`);
  if (a.bools.has("all-companies")) {
    const parts = await Promise.all(Object.keys(cfg.companies).map(async (slug) => ({ slug, out: await cmd({ ...a, words: [...a.words] }, cfg, slug) })));
    return { command, out: { data: { companies: parts.map((p) => ({ company: p.slug, ...(p.out.data as object) })) }, text: parts.map((p) => `== ${p.slug}\n${p.out.text}`).join("\n\n") } };
  }
  return { command, out: await cmd(a, cfg, pickCompany(cfg, a.flags.company)) };
}

const argv = process.argv.slice(2);
const json = argv.includes("--json");
try {
  const { command, out } = await main(argv);
  console.log(json ? JSON.stringify({ ok: true, command, data: out.data, schema_version: 2, warnings: out.warnings ?? [] }, null, 2) : out.text);
  if (!json && out.notice) console.error(out.notice);
} catch (e) {
  const err = e instanceof CliError ? e : new CliError(1, "error", e instanceof Error ? e.message : String(e));
  if (json) console.log(JSON.stringify({ ok: false, error: { code: err.code, kind: err.kind, message: err.message } }, null, 2));
  else console.error(`rs: ${err.message}`);
  process.exitCode = err.code;
}
