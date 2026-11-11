// Assignments: an outcome handed to one agent. Also what agents report while they work: outward actions,
// session receipts and presence. The Curator hands out assignments; it never does them.
//
// Five things stay apart here, and every view keeps them apart:
//   assigned   the assignment itself: brief, owner, status            (assignment.*)
//   executed   what the agent's sessions did                           (agent.receipt -> Journal session entries)
//   acted      outward actions the agent took                          (action.record -> Journal action entries)
//   reported   the result the agent says it got                        (assignment.report -> `result`, an outcome entry)
//   reviewed   attributed opinions in Journal notes                    (assignment.review)
// Historical verification evidence is retained; new reviews confer no authority.
//
// Before schema 3 these were work orders. The `work.*` operations below are the old names, kept as aliases
// with their old output shapes (docs/design/ASSIGNMENTS.md says until when).
import { Type } from "typebox";
import type { Company } from "../core/company.ts";
import { invalid } from "../core/errors.ts";
import * as records from "../core/records.ts";
import { ASSIGNMENT_FINAL, ASSIGNMENT_OPEN } from "../core/schema.ts";
import { Limit, meta, op, Ref, who, type Ctx, type Operation } from "./define.ts";

export const STATUS_WORDS: Record<string, string> = {
  queued: "Waiting for the agent", picked_up: "Claimed", in_progress: "In progress", blocked: "Blocked", needs_permission: "Blocked (legacy)",
  done: "Result reported", failed: "Reported not finished", cancelled: "Cancelled",
};

// Outward actions an agent records so a person sees them. Nothing here asks for permission.
export const ACTIONS: [id: string, label: string, covers: string][] = [
  ["spend", "Spend money", "buying, subscriptions, invoices, transfers"],
  ["ads", "Change ads", "budgets, bids, creatives, turning campaigns on or off"],
  ["publish", "Publish", "pages, posts, listings, anything the public sees"],
  ["email_customers", "Email customers", "any email to customers or lists"],
  ["message_customers", "Message customers", "SMS, chat, DMs, review replies"],
  ["prices", "Change prices", "prices, discounts, coupons"],
  ["ecommerce", "Change store settings", "shipping, checkout, inventory, store config"],
  ["deploy", "Deploy", "releasing code or config to a live system"],
  ["command", "Run a flagged command", "a shell command the agent's guard flagged"],
];

/** Compatibility readback of a historical review bound to this exact state revision, never authorization. */
export type Verification = { state: "not_verified" | "verified" | "disputed"; by: string | null; at: string | null; note: string | null };

export type Assignment = {
  id: string; key: string; kind: "assignment"; rev: number; title: string; owner: string; status: string; status_words: string;
  brief: unknown; progress: unknown; answer: unknown; due_on: unknown; project: string | null; updated_at: string;
  /** The result the agent reported (its word, not a check). */
  result: unknown; reported_by: string | null; reported_at: string | null;
  verification: Verification; historical_reviews: records.HistoricalReview[];
};
/** The old name of an Assignment. The shape is the same (Assignment only adds fields). */
export type Order = Assignment;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function assignmentOf(co: Company, r: records.Rec): Assignment {
  const b = r.body;
  const status = typeof b.status === "string" && STATUS_WORDS[b.status] ? b.status : "queued";
  const project = typeof b.project_id === "string" ? (records.get(co, b.project_id)?.key ?? null) : null;
  const verdict = b.verification === "verified" || b.verification === "disputed" ? b.verification : "not_verified";
  return {
    id: r.id, key: r.key, kind: "assignment", rev: r.rev, title: String(b.title ?? r.key), owner: String(b.owner ?? ""), status, status_words: STATUS_WORDS[status] ?? status,
    brief: b.brief ?? null, progress: b.progress ?? null, answer: b.answer ?? null, due_on: b.due_on ?? null, project, updated_at: r.updated_at,
    result: b.result ?? null, reported_by: str(b.reported_by), reported_at: str(b.reported_at),
    historical_reviews: records.historicalReviews(co, r.id),
    verification: { state: verdict, by: str(b.verified_by), at: str(b.verified_at), note: str(b.verification_note) },
  };
}

export const openAssignments = (co: Company, owner?: string): records.Rec[] =>
  records.list(co, { kind: "assignment", statuses: ASSIGNMENT_OPEN, where: owner ? { owner } : {}, limit: 1000 });

export const assignmentCursor = (r: records.Rec): string => Buffer.from(JSON.stringify([r.updated_at, r.key])).toString("base64url");

/** The assignment, or a refusal when the record is something else. */
function assignment(ctx: Ctx, ref: string): records.Rec {
  const r = records.need(ctx.company, ref);
  if (r.kind !== "assignment") throw invalid(`${r.key} is a ${r.kind}, not an assignment`);
  return r;
}

/** Move an assignment the caller may move. `from`: the statuses it may move from (any open one when left out). */
function move(ctx: Ctx, ref: string, status: string, o: { set?: records.Body; outcome?: string; from?: string[] } = {}): Assignment {
  const cur = assignment(ctx, ref);
  const now = String(cur.body.status ?? "queued");
  if (ASSIGNMENT_FINAL.includes(now)) throw invalid(`${cur.key} is already ${now}`);
  if (o.from && !o.from.includes(now)) throw invalid(`${cur.key} is ${STATUS_WORDS[now] ?? now}: it cannot go to ${STATUS_WORDS[status] ?? status} from there`);
  const r = records.patchAssignment(ctx.company, who(ctx), cur.id, { status, ...o.set }, meta(ctx));
  if (o.outcome) records.logEntry(ctx.company, who(ctx), "outcome", o.outcome, r, meta(ctx));
  return assignmentOf(ctx.company, r);
}

/** The assignment named by `assignment` or its old name `work_order` (agent.receipt, action.record). */
function underAssignment(ctx: Ctx, i: { assignment?: string | undefined; work_order?: string | undefined }): records.Rec | null {
  if (i.assignment && i.work_order && records.need(ctx.company, i.assignment).id !== records.need(ctx.company, i.work_order).id)
    throw invalid("work_order is the old name of assignment: give one of them");
  const ref = i.assignment ?? i.work_order;
  return ref ? assignment(ctx, ref) : null;
}

const Outcome = Type.String({ minLength: 1, maxLength: 300, description: "The outcome, result first" });
const linked = (ctx: Ctx, r: records.Rec, type: string) =>
  records.list(ctx.company, { kind: "entry", where: { type }, associatedAssignment: { id: r.id, key: r.key }, assertionOrder: true, limit: 50 }).map((x) => ({ key: x.key, title: String(x.assertion?.payload.title ?? records.titleOf(ctx.company, x)), at: x.assertion?.at ?? x.created_at, by: x.assertion?.actor ?? "unknown", phase: x.assertion?.phase ?? null, assertion: x.assertion, assertion_context: x.assertion_context, organizational_assignment: typeof x.body.assignment_id === "string" ? records.get(ctx.company, x.body.assignment_id)?.key ?? null : null }));
// Blockers, including legacy needs_permission, do not require another actor to resume.
const WORKABLE = ["queued", "picked_up", "in_progress", "blocked", "needs_permission"];

export const assignmentOperations: Operation[] = [
  op({
    name: "assignment.list", summary: "Assignments, newest first (open ones unless `all`)", role: "viewer", write: false,
    input: Type.Object({ all: Type.Optional(Type.Boolean()), owner: Type.Optional(Type.String()), project: Type.Optional(Ref), limit: Limit(500), after: Type.Optional(Type.String()) }),
    run: (ctx, i) => {
      const project = i.project ? records.need(ctx.company, i.project).id : undefined;
      return records.list(ctx.company, { kind: "assignment", ...(i.all ? {} : { statuses: ASSIGNMENT_OPEN }),
        where: { ...(i.owner ? { owner: i.owner } : {}), ...(project ? { project_id: project } : {}) },
        limit: i.limit ?? 100, after: i.after }).map((r) => ({ ...assignmentOf(ctx.company, r), cursor: assignmentCursor(r) }));
    },
  }),
  op({
    name: "assignment.show", summary: "One assignment with the outcomes, sessions and outward actions recorded under it", role: "viewer", write: false,
    input: Type.Object({ ref: Ref }),
    run: (ctx, i) => {
      const r = assignment(ctx, i.ref);
      return { ...assignmentOf(ctx.company, r), outcomes: linked(ctx, r, "outcome"), sessions: linked(ctx, r, "session"), actions: linked(ctx, r, "action"), notes: linked(ctx, r, "note") };
    },
  }),
  op({
    name: "assignment.next", summary: "Claim your oldest waiting assignment (agents)", role: "member", write: true,
    input: Type.Object({}),
    run: (ctx) => {
      const next = records.list(ctx.company, { kind: "assignment", status: "queued", where: { owner: ctx.actor.name }, order: "oldest", limit: 1 })[0];
      if (!next) return { assignment: null };
      return { assignment: assignmentOf(ctx.company, records.patchAssignment(ctx.company, who(ctx), next.id, { status: "picked_up" }, meta(ctx))), claimed: true };
    },
  }),
  op({
    name: "assignment.claim", summary: "Claim one waiting assignment by its key", role: "member", write: true,
    input: Type.Object({ ref: Ref }),
    run: (ctx, i) => move(ctx, i.ref, "picked_up", { from: ["queued"] }),
  }),
  op({
    name: "assignment.start", summary: "Mark an assignment as in progress (optionally with a progress note)", role: "member", write: true,
    input: Type.Object({ ref: Ref, progress: Type.Optional(Type.String({ maxLength: 500 })) }),
    run: (ctx, i) => move(ctx, i.ref, "in_progress", { set: i.progress ? { progress: i.progress } : {}, from: WORKABLE }),
  }),
  op({
    name: "assignment.report", summary: "Finish an assignment by reporting its outcome (a report, not a verification)", role: "member", write: true,
    input: Type.Object({ ref: Ref, result: Outcome }),
    run: (ctx, i) => move(ctx, i.ref, "done", { set: { result: i.result, reported_by: ctx.actor.name, reported_at: new Date().toISOString() }, outcome: i.result, from: WORKABLE }),
  }),
  op({
    name: "assignment.fail", summary: "Say you could not finish an assignment, and why", role: "member", write: true,
    input: Type.Object({ ref: Ref, result: Outcome }),
    run: (ctx, i) => move(ctx, i.ref, "failed", { set: { result: i.result, reported_by: ctx.actor.name, reported_at: new Date().toISOString() }, outcome: `Could not finish: ${i.result}`.slice(0, 300) }),
  }),
  op({
    name: "assignment.need_permission", summary: "Deprecated: record a blocker; it does not require permission", role: "member", write: true,
    input: Type.Object({ ref: Ref, detail: Type.String({ minLength: 1, maxLength: 500, description: "What is blocking progress" }) }),
    run: (ctx, i) => move(ctx, i.ref, "blocked", { set: { progress: i.detail }, from: WORKABLE }),
  }),
  op({
    name: "assignment.answer", summary: "Deprecated: append an answer note without authorizing or resuming work", role: "member", write: true,
    input: Type.Object({ ref: Ref, answer: Type.String({ minLength: 1, maxLength: 1000, description: "Context to record as a note" }) }),
    run: (ctx, i) => {
      const cur = assignment(ctx, i.ref);
      records.logEntry(ctx.company, who(ctx), "note", i.answer, cur, meta(ctx), { note_type: "answer", detail: i.answer, reviewed_rev: cur.rev });
      return assignmentOf(ctx.company, cur);
    },
  }),
  op({
    name: "assignment.cancel", summary: "Record cancellation of an unfinished assignment", role: "member", write: true,
    input: Type.Object({ ref: Ref, why: Type.Optional(Type.String({ maxLength: 500 })) }),
    run: (ctx, i) => move(ctx, i.ref, "cancelled", { set: i.why ? { result: i.why } : {} }),
  }),
  op({
    name: "assignment.verify", summary: "Deprecated: append an attributed review note; historical verification is unchanged", role: "member", write: true,
    input: Type.Object({
      ref: Ref, verdict: Type.Union([Type.Literal("verified"), Type.Literal("disputed")]),
      note: Type.Optional(Type.String({ maxLength: 1000, description: "What you checked, or what does not hold up" })),
    }),
    run: (ctx, i) => {
      const cur = assignment(ctx, i.ref);
      records.logEntry(ctx.company, who(ctx), "note", i.note ?? `Review opinion: ${i.verdict}`, cur, meta(ctx), { note_type: "review", verdict: i.verdict, detail: i.note ?? null, reviewed_rev: cur.rev });
      return assignmentOf(ctx.company, cur);
    },
  }),
  op({
    name: "assignment.review", summary: "Append an attributed review note; no execution or authorization", role: "member", write: true,
    input: Type.Object({ ref: Ref, note: Type.String({ minLength: 1, maxLength: 1000 }) }),
    run: (ctx, i) => {
      const cur = assignment(ctx, i.ref);
      return records.logEntry(ctx.company, who(ctx), "note", i.note, cur, meta(ctx), { note_type: "review", detail: i.note, reviewed_rev: cur.rev });
    },
  }),
  op({
    name: "action.record", summary: "Journal an outward action (spend, ads, publish...) so a person sees it. No permission is needed", role: "member", write: true,
    input: Type.Object({
      action: Type.Union(ACTIONS.map(([id]) => Type.Literal(id))), detail: Type.String({ minLength: 1, maxLength: 300, description: "What you did, in words a person reads" }),
      phase: Type.Optional(Type.Union([Type.Literal("attempted"), Type.Literal("reported")])),
      amount: Type.Optional(Type.Number()), unit: Type.Optional(Type.String({ maxLength: 20 })),
      assignment: Type.Optional(Ref), work_order: Type.Optional({ ...Ref, description: "Old name of `assignment`" }),
    }),
    run: (ctx, i) => {
      const extra: records.Body = { action: i.action, phase: i.phase ?? "reported", external_verified: false };
      if (i.amount !== undefined) extra.amount = i.amount;
      if (i.unit) extra.unit = i.unit;
      const r = records.logEntry(ctx.company, who(ctx), "action", i.detail, underAssignment(ctx, i), meta(ctx), extra);
      return { decision: "allow", recorded: true, authorization: false, external_verified: false, reason: "receipt only; legacy decision is not authorization or evidence of execution", key: r.key };
    },
  }),
  op({
    name: "action.kinds", summary: "The outward actions an agent records", role: "viewer", write: false,
    input: Type.Object({}),
    run: () => ACTIONS.map(([id, label, covers]) => ({ id, label, covers })),
  }),
  op({
    name: "agent.receipt", summary: "Journal one line on what your session did (written by the agent's plugin)", role: "member", write: true,
    input: Type.Object({
      summary: Type.String({ minLength: 1, maxLength: 300 }), session: Type.Optional(Type.String({ maxLength: 120 })),
      assignment: Type.Optional(Ref), work_order: Type.Optional({ ...Ref, description: "Old name of `assignment`" }),
      detail: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
    }),
    run: (ctx, i) => {
      const extra: records.Body = {};
      if (i.session) extra.session = i.session;
      if (i.detail) extra.detail = i.detail;
      return { ok: true, key: records.logEntry(ctx.company, who(ctx), "session", i.summary, underAssignment(ctx, i), meta(ctx), extra).key };
    },
  }),
  op({
    name: "agent.presence", summary: "Say your session is alive (heartbeat)", role: "viewer", write: false,
    input: Type.Object({ session: Type.String({ minLength: 1, maxLength: 120 }) }),
    run: (ctx, i) => {
      ctx.company.run("insert into presence (agent, session, at) values (?, ?, ?) on conflict (agent) do update set session = excluded.session, at = excluded.at",
        ctx.actor.name, i.session, new Date().toISOString());
      return { ok: true };
    },
  }),
];

/**
 * The old `work.*` operations: same rights, same input, same output as before the rename (outputs only gain
 * fields). Hidden from MCP tool lists and the Curator; still callable by name. See docs/design/ASSIGNMENTS.md.
 */
const byName = new Map(assignmentOperations.map((o) => [o.name, o]));
const alias = (old: string, now: string, shape: (out: unknown) => unknown = (x) => x): Operation => {
  const o = byName.get(now)!;
  return { ...o, name: old, summary: `Old name of ${now}. ${o.summary}`, replacedBy: now, run: (ctx, input) => shape(o.run(ctx, input)) };
};
type Shown = Assignment & { outcomes: unknown[]; sessions: unknown[] };
export const legacyWorkOperations: Operation[] = [
  alias("work.list", "assignment.list"),
  alias("work.show", "assignment.show", (out) => { const s = out as Shown; return { ...s, results: s.outcomes, receipts: s.sessions }; }),
  alias("work.next", "assignment.next", (out) => { const { assignment: a, ...rest } = out as { assignment: Assignment | null; claimed?: boolean }; return { work_order: a, ...rest }; }),
  alias("work.start", "assignment.start"),
  alias("work.report", "assignment.report"),
  alias("work.fail", "assignment.fail"),
  alias("work.need_permission", "assignment.need_permission"),
  alias("work.answer", "assignment.answer"),
  alias("work.cancel", "assignment.cancel"),
];
