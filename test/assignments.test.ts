import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "../src/core/agents.ts";
import { addAgent } from "../src/core/agents.ts";
import { RsError } from "../src/core/errors.ts";
import type { Rec } from "../src/core/records.ts";
import { operations, run } from "../src/operations/index.ts";
import { isMachine, type JournalItem, type Pulse } from "../src/operations/views.ts";
import type { Assignment, Order } from "../src/operations/assignments.ts";
import { admin, member, rec, setup, viewer } from "./helpers.ts";

const code = (c: string) => (e: unknown) => e instanceof RsError && e.code === c;
const stranger: Actor = { kind: "agent", name: "hermes:else", role: "member" };

test("assignment: handed to an agent, claimed, started, reported; the outcome is journalled under its project", (t) => {
  const { acme } = setup(t);
  addAgent(acme, "hermes:acme");
  rec(acme, admin, "record.create", { kind: "project", body: { title: "Launch", status: "active" } });
  assert.throws(() => run(acme, admin, "record.create", { kind: "assignment", body: { title: "No owner" } }), /needs an owner/);
  assert.throws(() => run(acme, admin, "record.create", { kind: "assignment", body: { title: "Ghost", owner: "nobody" } }), /no active agent/);
  const a = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Check label", owner: "hermes:acme", brief: "Compare with KNW", project_id: "PRJ-0001", due_on: "2026-11-01" } });
  assert.deepEqual([a.key, a.kind, a.body.status], ["ASG-0001", "assignment", "queued"], "new assignments get ASG- keys");

  assert.deepEqual(run(acme, stranger, "assignment.next", {}), { assignment: null }, "another agent does not get it");
  const next = run(acme, member, "assignment.next", {}) as { assignment: Assignment; claimed: boolean };
  assert.deepEqual([next.assignment.key, next.assignment.status, next.assignment.status_words, next.claimed], ["ASG-0001", "picked_up", "Claimed", true]);
  assert.deepEqual(run(acme, member, "assignment.next", {}), { assignment: null }, "it is claimed once");

  assert.throws(() => run(acme, stranger, "assignment.start", { ref: "ASG-0001" }), code("forbidden"));
  assert.equal((run(acme, member, "assignment.start", { ref: "ASG-0001", progress: "Read the formula page" }) as Assignment).status, "in_progress");
  run(acme, member, "action.record", { action: "publish", detail: "Updated the listing copy", assignment: "ASG-0001" });
  run(acme, member, "agent.receipt", { summary: "Compared label with formula page", assignment: "ASG-0001", session: "s1" });
  const done = run(acme, member, "assignment.report", { ref: "ASG-0001", result: "Label matches the formula" }) as Assignment;
  assert.deepEqual([done.status, done.status_words, done.result, done.reported_by], ["done", "Result reported", "Label matches the formula", "hermes:acme"]);
  assert.ok(done.reported_at);
  assert.deepEqual(done.verification, { state: "not_verified", by: null, at: null, note: null }, "a report is not a verification");
  assert.throws(() => run(acme, member, "assignment.report", { ref: "ASG-0001", result: "again" }), /already done/);

  const results = run(acme, member, "journal.list", { type: "outcome" }) as JournalItem[];
  assert.deepEqual(results.map((r) => [r.title, r.project, r.assignment, r.work_order, r.about?.key]), [["Label matches the formula", "PRJ-0001", "ASG-0001", "ASG-0001", "ASG-0001"]]);
  const entries = rec(acme, member, "record.list", { kind: "entry", where: { type: "outcome" } }) as unknown as Rec[];
  assert.equal(entries[0]?.body.assignment_id, a.id, "entries point at their assignment with assignment_id");
  assert.equal(entries[0]?.body.work_order_id, undefined);
  const shown = run(acme, member, "assignment.show", { ref: "ASG-0001" }) as Assignment & { outcomes: unknown[]; sessions: unknown[]; actions: unknown[] };
  assert.deepEqual([shown.outcomes.length, shown.sessions.length, shown.actions.length, shown.due_on, shown.project], [1, 1, 1, "2026-11-01", "PRJ-0001"]);
  assert.deepEqual(run(acme, member, "assignment.list", {}), [], "finished assignments leave the open list");
  assert.deepEqual((run(acme, member, "assignment.list", { all: true, project: "PRJ-0001" }) as Assignment[]).map((x) => x.key), ["ASG-0001"]);
  assert.throws(() => run(acme, member, "assignment.show", { ref: "PRJ-0001" }), /is a project, not an assignment/);
});

test("assignment lifecycle rules: claim by key, no self-unblocking, only a person verifies, and not the reporter", (t) => {
  const { acme } = setup(t);
  addAgent(acme, "hermes:acme");
  for (const title of ["One", "Two"]) rec(acme, admin, "record.create", { kind: "assignment", body: { title, owner: "hermes:acme" } });
  assert.throws(() => run(acme, stranger, "assignment.claim", { ref: "ASG-0002" }), code("forbidden"), "only the owner claims it");
  assert.equal((run(acme, member, "assignment.claim", { ref: "ASG-0002" }) as Assignment).status, "picked_up");
  assert.throws(() => run(acme, member, "assignment.claim", { ref: "ASG-0002" }), /cannot go to Claimed/, "a claimed one is not claimed again");
  assert.equal((run(acme, member, "assignment.next", {}) as { assignment: Assignment }).assignment.key, "ASG-0001", "next skips what is already claimed");

  run(acme, member, "assignment.need_permission", { ref: "ASG-0002", detail: "May I email the supplier?" });
  assert.throws(() => run(acme, member, "assignment.start", { ref: "ASG-0002" }), /cannot go to In progress/, "the agent cannot answer its own question");
  assert.throws(() => run(acme, member, "assignment.report", { ref: "ASG-0002", result: "Emailed" }), /cannot go to Result reported/);
  run(acme, admin, "assignment.answer", { ref: "ASG-0002", answer: "Yes" });
  run(acme, member, "assignment.report", { ref: "ASG-0002", result: "Supplier confirmed 4-week lead time" });

  const boss: Actor = { kind: "agent", name: "hermes:boss", role: "admin" };
  assert.throws(() => run(acme, boss, "assignment.verify", { ref: "ASG-0002", verdict: "verified" }), /only a person verifies/);
  assert.throws(() => run(acme, member, "assignment.verify", { ref: "ASG-0002", verdict: "verified" }), code("forbidden"), "a member cannot verify");
  assert.throws(() => run(acme, admin, "assignment.verify", { ref: "ASG-0001", verdict: "verified" }), /no reported result to verify/);
  const v = run(acme, admin, "assignment.verify", { ref: "ASG-0002", verdict: "verified", note: "Read the supplier's email" }) as Assignment;
  assert.deepEqual([v.verification.state, v.verification.by, v.verification.note, v.status], ["verified", "alex", "Read the supplier's email", "done"]);

  // A person who reported a result themselves cannot also verify it.
  rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Three", owner: "hermes:acme" } });
  run(acme, admin, "assignment.report", { ref: "ASG-0003", result: "I did it myself" });
  assert.throws(() => run(acme, admin, "assignment.verify", { ref: "ASG-0003", verdict: "verified" }), /cannot also verify/);
  assert.equal((run(acme, { kind: "person", name: "dana", role: "admin" }, "assignment.verify", { ref: "ASG-0003", verdict: "disputed" }) as Assignment).verification.state, "disputed");
});

test("assignments stay in their company", (t) => {
  const { acme, other } = setup(t);
  addAgent(acme, "hermes:acme");
  addAgent(other, "hermes:acme");
  rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Acme only", owner: "hermes:acme" } });
  assert.deepEqual(run(other, member, "assignment.list", { all: true }), []);
  assert.throws(() => run(other, member, "assignment.show", { ref: "ASG-0001" }), code("not_found"));
  assert.throws(() => run(other, member, "work.show", { ref: "ASG-0001" }), code("not_found"));
  assert.deepEqual(run(other, member, "assignment.next", {}), { assignment: null }, "the same agent name in another company gets nothing from Acme");
  assert.throws(() => run(other, member, "action.record", { action: "spend", detail: "x", assignment: "ASG-0001" }), code("not_found"));
  assert.equal(rec(other, admin, "record.create", { kind: "assignment", body: { title: "Other's own", owner: "hermes:acme" } }).key, "ASG-0001", "each company counts its own keys");
});

test("old names keep working: work.* operations, kind work_order, work_order and work_order_id", (t) => {
  const { acme } = setup(t);
  addAgent(acme, "hermes:acme");
  const wo = rec(acme, admin, "record.create", { kind: "work_order", body: { title: "Old caller", owner: "hermes:acme" } });
  assert.deepEqual([wo.kind, wo.key, wo.body.status], ["assignment", "ASG-0001", "queued"], "kind work_order makes an assignment");
  const next = run(acme, member, "work.next", {}) as { work_order: Order; claimed: boolean };
  assert.deepEqual([next.work_order.key, next.claimed], ["ASG-0001", true], "work.next answers in its old shape");
  assert.equal((run(acme, member, "work.list", {}) as Order[])[0]?.key, "ASG-0001");
  assert.equal((run(acme, member, "work.start", { ref: "ASG-0001" }) as Order).status, "in_progress");
  run(acme, member, "action.record", { action: "ads", detail: "Raised the budget", work_order: "ASG-0001" });
  run(acme, member, "agent.receipt", { summary: "Ran the budget script", work_order: "ASG-0001" });
  assert.throws(() => run(acme, member, "action.record", { action: "ads", detail: "x", work_order: "ASG-0001", assignment: "JNL-0001" }), /old name of assignment/);
  run(acme, member, "work.report", { ref: "ASG-0001", result: "Budget is $60/day" });
  const shown = run(acme, member, "work.show", { ref: "ASG-0001" }) as Order & { results: unknown[]; receipts: unknown[]; actions: unknown[] };
  assert.deepEqual([shown.results.length, shown.receipts.length, shown.actions.length], [1, 1, 1], "work.show keeps results and receipts");
  // An entry written with the old field lands on the new one; old filters still find it.
  const note = rec(acme, member, "record.create", { kind: "entry", body: { type: "note", title: "Old-style link", work_order_id: "ASG-0001" } });
  assert.deepEqual([note.body.assignment_id, note.body.work_order_id], [wo.id, undefined]);
  assert.throws(() => run(acme, member, "record.create", { kind: "entry", body: { title: "Both", work_order_id: "ASG-0001", assignment_id: "JNL-0001" } }), /old name of assignment_id/);
  assert.equal((rec(acme, member, "record.list", { kind: "entry", where: { work_order_id: wo.id } }) as unknown as Rec[]).length, 4);
  assert.equal((rec(acme, member, "record.list", { kind: "work_order", archived: "all" }) as unknown as Rec[]).length, 1);
  assert.equal(run(acme, member, "kind.list", {}) instanceof Array && (run(acme, member, "kind.list", {}) as { kind: string }[]).some((k) => k.kind === "work_order"), false);
  // The old name and prefix stay reserved, so a WO- key always means an assignment.
  assert.throws(() => run(acme, admin, "kind.define", { kind: "work_order", prefix: "WRK" }), /old name of assignment/);
  assert.throws(() => run(acme, admin, "kind.define", { kind: "widget", prefix: "WO" }), /kept for keys/);
  // Aliases answer but are not offered as tools.
  const ops = operations.filter((o) => o.name.startsWith("work."));
  assert.ok(ops.length === 9 && ops.every((o) => o.replacedBy?.startsWith("assignment.")));
});

test("--result on any write records a result about that record", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "project", body: { title: "P" } });
  rec(acme, member, "record.create", { kind: "task", body: { title: "Call supplier", status: "todo", project_id: "PRJ-0001" } });
  rec(acme, member, "record.patch", { ref: "TSK-0001", set: { status: "done" }, result: "Supplier confirmed 4-week lead time" });
  rec(acme, member, "journal.log", { title: "Site is live", detail: "DNS switched", project: "PRJ-0001" });
  const results = run(acme, member, "journal.list", { project: "PRJ-0001" }) as JournalItem[];
  assert.deepEqual(results.map((r) => [r.title, r.about?.key ?? null, r.project]).sort(), [["Site is live", null, "PRJ-0001"], ["Supplier confirmed 4-week lead time", "TSK-0001", "PRJ-0001"]]);
});

test("brief, activity, today and company views", (t) => {
  const { acme } = setup(t);
  addAgent(acme, "hermes:acme");
  run(acme, admin, "company.update", { brief: "We sell magnesium. Win on trust." });
  rec(acme, admin, "record.create", { kind: "goal", body: { title: "Double repeat orders", status: "active" } });
  rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Audit claims", owner: "hermes:acme" } });
  const brief = (run(acme, member, "brief.get", {}) as { text: string }).text;
  for (const part of ["## Acme (acme)", "We sell magnesium", "GOAL-0001 Double repeat orders", "Your open assignments:", "ASG-0001 [Waiting for the agent] Audit claims", "rs assignment next", "a person verifies it"]) assert.ok(brief.includes(part), part);
  assert.ok((run(acme, member, "brief.get", { budget: 500 }) as { text: string }).text.length <= 700);
  const activity = run(acme, member, "activity.list", { since: "1h" }) as { key: string; op: string; actor: string }[];
  assert.deepEqual(activity.map((a) => a.key), ["ASG-0001", "GOAL-0001", "CO-0001"]);
  run(acme, member, "assignment.next", {});
  run(acme, member, "assignment.need_permission", { ref: "ASG-0001", detail: "May I email the supplier?" });
  const today = run(acme, member, "today.get", {}) as { needs_you: Assignment[]; open_work: Assignment[] };
  assert.equal((run(acme, viewer, "pulse.get", {}) as Pulse).needs, 1, "an assignment waiting for an answer needs a person");
  assert.deepEqual((run(acme, admin, "inbox.get", {}) as { needs_you: { key: string }[] }).needs_you.map((n) => n.key), ["ASG-0001"]);
  assert.equal(today.needs_you[0]?.progress, "May I email the supplier?");
  const co = run(acme, member, "company.get", {}) as { brief: string; kinds: { kind: string; live: number }[] };
  assert.equal(co.brief, "We sell magnesium. Win on trust.");
  assert.deepEqual(co.kinds.map((k) => [k.kind, k.live]), [["assignment", 1], ["company", 1], ["goal", 1]]);
});

test("pulse: what waits, whether the agent works, what mattered; raw commands are machine work, not news", (t) => {
  const { acme } = setup(t);
  run(acme, member, "agent.presence", { session: "s1" });
  run(acme, member, "action.record", { action: "ads", detail: "ads API: cd ~/x; cat > pull.py <<EOF import json" });
  run(acme, member, "action.record", { action: "ads", detail: "Paused 3 campaigns that spent with no sales" });
  run(acme, member, "journal.log", { title: "Repeat orders rose 12% after the email", type: "outcome" });
  run(acme, member, "agent.receipt", { summary: "4 steps: terminal ok; terminal failed: npm test" });
  rec(acme, admin, "record.create", { kind: "flag", body: { title: "Two tasks say the same", status: "open" } });
  const p = run(acme, viewer, "pulse.get", {}) as Pulse;
  assert.equal(p.needs, 1);
  assert.equal(p.agent?.name, "hermes:acme");
  assert.equal(p.agent?.working, true);
  assert.deepEqual(p.highlights.map((h) => h.title).sort(), ["Paused 3 campaigns that spent with no sales", "Repeat orders rose 12% after the email"]);
  assert.deepEqual([p.day.entries, p.day.sessions, p.day.failed], [4, 1, 1]);
  assert.equal(p.week.length, 7);
  assert.equal(p.week[6], 4);
  assert.ok(isMachine("ads API: cd ~/hermes/x && python3 pull.py"));
  assert.ok(!isMachine("Ads 1234567890: removed 12 paused campaigns; readback REMOVED each"));
});

test("agents, keys and attachments through operations", (t) => {
  const { acme, companies } = setup(t);
  run(acme, admin, "agent.add", { name: "hermes:new" });
  const { key } = run(acme, admin, "agent.key", { name: "hermes:new" }) as { key: string };
  assert.equal(companies.authenticate(key)?.actor.name, "hermes:new");
  assert.equal(acme.all("select * from ops").length, 0, "a key never lands in the op ledger");
  run(acme, member, "agent.presence", { session: "s1" });
  assert.ok((run(acme, member, "agent.list", {}) as { name: string; last_seen: string | null }[]).length === 1);
  run(acme, admin, "agent.revoke", { name: "hermes:new" });
  assert.equal(companies.authenticate(key), undefined);
  assert.throws(() => run(acme, member, "agent.key", { name: "hermes:new" }), code("forbidden"));
  const put = run(acme, member, "blob.put", { b64: Buffer.from("hello").toString("base64") }) as { sha256: string; size: number };
  assert.equal(put.size, 5);
  assert.equal(Buffer.from((run(acme, member, "blob.get", { sha256: put.sha256 }) as { b64: string }).b64, "base64").toString(), "hello");
  const r = rec(acme, member, "record.list", { kind: "entry", where: { tier: "gold" } }) as unknown as Rec[];
  assert.deepEqual(r, []);
});

test("a person answers an assignment that waits, or cancels one", (t) => {
  const { acme } = setup(t);
  addAgent(acme, "hermes:acme");
  rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Email the supplier", owner: "hermes:acme" } });
  run(acme, member, "assignment.next", {});
  assert.throws(() => run(acme, admin, "assignment.answer", { ref: "ASG-0001", answer: "yes" }), /not waiting/);
  run(acme, member, "assignment.need_permission", { ref: "ASG-0001", detail: "May I email the supplier?" });
  assert.throws(() => run(acme, member, "assignment.answer", { ref: "ASG-0001", answer: "yes" }), code("forbidden"));
  const o = run(acme, admin, "assignment.answer", { ref: "ASG-0001", answer: "Yes, but copy me." }) as Assignment;
  assert.deepEqual([o.status, o.answer], ["in_progress", "Yes, but copy me."]);
  assert.throws(() => run(acme, member, "assignment.cancel", { ref: "ASG-0001" }), code("forbidden"), "only an admin cancels");
  assert.equal((run(acme, admin, "assignment.cancel", { ref: "ASG-0001", why: "No longer needed" }) as Assignment).status, "cancelled");
  assert.throws(() => run(acme, admin, "assignment.cancel", { ref: "ASG-0001" }), /already cancelled/);
});
