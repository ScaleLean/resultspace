import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "../src/core/agents.ts";
import { addAgent } from "../src/core/agents.ts";
import { RsError } from "../src/core/errors.ts";
import { create, patch, setArchived, type Rec } from "../src/core/records.ts";
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

  assert.equal((run(acme, stranger, "assignment.start", { ref: "ASG-0001" }) as Assignment).status, "in_progress");
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
  for (const part of ["## Acme (acme)", "We sell magnesium", "GOAL-0001 Double repeat orders", "Your open assignments:", "ASG-0001 [Waiting for the agent] Audit claims", "rs assignment next", "members can add review notes"]) assert.ok(brief.includes(part), part);
  assert.ok((run(acme, member, "brief.get", { budget: 500 }) as { text: string }).text.length <= 700);
  const activity = run(acme, member, "activity.list", { since: "1h" }) as { key: string; op: string; actor: string }[];
  assert.deepEqual(activity.map((a) => a.key), ["ASG-0001", "GOAL-0001", "CO-0001"]);
  run(acme, member, "assignment.next", {});
  run(acme, member, "assignment.need_permission", { ref: "ASG-0001", detail: "May I email the supplier?" });
  const today = run(acme, member, "today.get", {}) as { needs_you: Assignment[]; open_work: Assignment[] };
  assert.equal((run(acme, viewer, "pulse.get", {}) as Pulse).needs, 1, "a blocker is listed for attention, without enforcing a gate");
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

test("members create, reassign, edit, resume, report and review assignments regardless of owner", (t) => {
  const { acme } = setup(t);
  addAgent(acme, member.name); addAgent(acme, stranger.name);
  const a = rec(acme, member, "record.create", { kind: "assignment", body: { title: "Shared", owner: member.name } });
  run(acme, stranger, "assignment.claim", { ref: a.key });
  run(acme, stranger, "assignment.need_permission", { ref: a.key, detail: "Waiting for information" });
  assert.equal(rec(acme, member, "record.get", { ref: a.key }).body.status, "blocked");
  run(acme, member, "assignment.answer", { ref: a.key, answer: "Here is context" });
  assert.equal(rec(acme, member, "record.get", { ref: a.key }).body.status, "blocked", "an answer is a note, not a transition");
  run(acme, stranger, "assignment.start", { ref: a.key });
  rec(acme, stranger, "record.patch", { ref: a.key, set: { owner: stranger.name, brief: "Updated" } });
  run(acme, member, "assignment.report", { ref: a.key, result: "Reported outcome" });
  const before = rec(acme, member, "record.get", { ref: a.key });
  run(acme, member, "assignment.verify", { ref: a.key, verdict: "verified", note: "An opinion" });
  run(acme, stranger, "assignment.review", { ref: a.key, note: "Checked locally" });
  assert.deepEqual(rec(acme, member, "record.get", { ref: a.key }), before);
  const shown = run(acme, member, "assignment.show", { ref: a.key }) as Assignment & { notes: { by: string }[] };
  assert.equal(shown.notes.length, 3);
  assert.equal(shown.verification.state, "not_verified");
  for (const name of ["record.archive", "record.restore", "record.undo"]) run(acme, stranger, name, { ref: a.key });
  rec(acme, stranger, "record.restore", { ref: a.key });
  const edit = rec(acme, stranger, "record.patch", { ref: a.key, set: { result: "Corrected", status: "in_progress" } });
  assert.equal(edit.body.reported_by, stranger.name);
  for (const field of ["reported_by", "reported_at", "verification", "verified_by", "verified_at", "verification_note", "answered_by", "_source", "provenance"]) {
    assert.throws(() => run(acme, member, "record.patch", { ref: a.key, set: { [field]: "forged" } }), code("forbidden"));
    assert.throws(() => run(acme, member, "record.create", { kind: "assignment", body: { title: "Bad", owner: member.name, [field]: "forged" } }), code("forbidden"));
  }
  assert.throws(() => run(acme, stranger, "record.patch", { ref: a.key, set: { owner: "missing" } }), /no active agent/);
  assert.throws(() => run(acme, stranger, "record.patch", { ref: a.key, set: { title: "Stale" }, base_rev: 1 }), code("conflict"));
});

test("assignment associations never restrict shared-company task and Journal writes", (t) => {
  const { acme, other } = setup(t);
  addAgent(acme, member.name); addAgent(acme, stranger.name);
  const a = create(acme, member, "assignment", { title: "One", owner: member.name });
  const b = create(acme, stranger, "assignment", { title: "Two", owner: stranger.name });
  const task = create(acme, stranger, "task", { title: "Step", assignment_id: a.id });
  for (const type of ["outcome", "session", "action", "note"]) {
    const entry = create(acme, stranger, "entry", { title: "Evidence", type, about_id: task.id, work_order_id: a.key });
    patch(acme, member, entry.id, { assignment_id: b.id, title: "Shared" });
    patch(acme, stranger, entry.id, { assignment_id: null, about_id: null });
    patch(acme, member, entry.id, { title: "Still shared" });
    for (const archived of [true, false]) setArchived(acme, stranger, entry.id, archived);
    run(acme, member, "record.undo", { ref: entry.key });
  }
  patch(acme, member, task.id, { assignment_id: b.key, status: "done" });
  run(acme, stranger, "record.undo", { ref: task.key });
  rec(acme, stranger, "journal.log", { title: "Shared report", about: a.key });
  run(acme, stranger, "agent.receipt", { summary: "Session report", assignment: a.key });
  const receipt = run(acme, stranger, "action.record", { action: "deploy", detail: "Call observed", assignment: a.key, phase: "attempted" }, "receipt-action-001") as { key: string; recorded: boolean; authorization: boolean; external_verified: boolean };
  assert.deepEqual([receipt.recorded, receipt.authorization, receipt.external_verified], [true, false, false]);
  assert.equal(rec(acme, member, "record.get", { ref: receipt.key }).body.phase, "attempted");
  assert.deepEqual(run(acme, stranger, "action.record", { action: "deploy", detail: "Call observed", assignment: a.key, phase: "attempted" }, "receipt-action-001"), receipt);
  for (const kind of ["task", "entry"]) {
    for (const assignment_id of [a.id, 42, "ASG-9999"]) assert.throws(() => run(other, member, "record.create", { kind, body: { title: "Bad reference", assignment_id } }), code("invalid"));
  }
  assert.throws(() => run(acme, viewer, "assignment.review", { ref: a.key, note: "Denied" }), code("forbidden"));
  assert.throws(() => create(acme, viewer, "task", { title: "Denied" }), code("forbidden"));
  assert.throws(() => patch(acme, viewer, task.id, { title: "Denied" }), code("forbidden"));
  assert.throws(() => setArchived(acme, viewer, task.id, true), code("forbidden"));
});

for (const path of ["patch", "remove", "report", "fail", "cancel"] as const) {
  test(`changed assignment result clears current verification through ${path}, retaining historical evidence`, (t) => {
    const { acme } = setup(t); // Disposable company file only.
    addAgent(acme, member.name); addAgent(acme, stranger.name);
    const a = create(acme, member, "assignment", { title: "Historical result", owner: member.name, status: "done", result: "Original claim" });
    // Fixture for a historical server's attributed verification, including its append-only revision.
    const evidence = { verification: "verified", verified_by: "historical-reviewer", verified_at: "2099-09-05T12:00:00.000Z", verification_note: "Checked original claim" };
    const body = { ...a.body, ...evidence };
    acme.tx(() => {
      acme.run("update records set body = ?, rev = 2, updated_by = 'historical-reviewer' where id = ?", JSON.stringify(body), a.id);
      acme.run("insert into revisions (record_id, rev, body, archived, changed, op, actor, actor_kind, at) values (?, 2, ?, 0, ?, 'patch', 'historical-reviewer', 'person', '2099-09-05T12:00:00.000Z')",
        a.id, JSON.stringify(body), JSON.stringify(Object.keys(evidence)));
      acme.run("insert into historical_reviews values (?, 2, 2, 'verified', 'historical-reviewer', 'person', '2099-09-05T12:00:00.000Z', 'Checked original claim', 'bound')", a.id);
    });
    const historical = run(acme, member, "record.history", { ref: a.key });
    const show = () => run(acme, stranger, "assignment.show", { ref: a.key }) as Assignment;
    assert.equal(show().verification.state, "verified");
    const unchanged = patch(acme, stranger, a.id, { result: "Original claim" });
    assert.equal(unchanged.rev, 2, "an unchanged result remains a no-op");
    assert.equal(show().verification.state, "verified");
    if (path === "patch" || path === "remove") {
      patch(acme, stranger, a.id, { result: path === "remove" ? null : "Changed claim" });
    } else {
      patch(acme, stranger, a.id, { status: "in_progress" });
      assert.equal(show().verification.state, "not_verified", "a status transition is a different snapshot");
      run(acme, stranger, `assignment.${path}`, { ref: a.key, ...(path === "cancel" ? { why: "Changed cancellation reason" } : { result: "Changed claim" }) });
    }
    assert.deepEqual(show().verification, { state: "not_verified", by: null, at: null, note: null });
    assert.equal(show().reported_by, stranger.name);
    const current = rec(acme, member, "record.get", { ref: a.key });
    for (const field of Object.keys(evidence)) assert.equal(current.body[field], undefined);
    const history = run(acme, member, "record.history", { ref: a.key }) as { body: Record<string, unknown> }[];
    assert.deepEqual(history.slice(0, 2), historical, "old revisions remain unchanged");
    assert.equal(history[1]!.body.result, "Original claim");
    assert.equal(history[1]!.body.verification, "verified");
    assert.equal(history[1]!.body.verified_by, "historical-reviewer");
    assert.throws(() => patch(acme, stranger, a.id, { verification: "verified", verified_by: "historical-reviewer" }), code("forbidden"));
  });
}
