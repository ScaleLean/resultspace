// Only disposable synthetic company files. Assertions are facts about snapshots, never permissions.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addAgent } from "../src/core/agents.ts";
import { create, need, patch, type Rec } from "../src/core/records.ts";
import { run } from "../src/operations/index.ts";
import type { Assignment } from "../src/operations/assignments.ts";
import type { JournalItem } from "../src/operations/views.ts";
import { admin, member, viewer, setup } from "./helpers.ts";
const colleague = { ...member, name: "colleague" };

test("immutable receipt survives patches, metadata undo, archive/restore and attributed correction", (t) => {
  const { acme, other } = setup(t);
  addAgent(acme, member.name); addAgent(acme, colleague.name);
  const a = create(acme, member, "assignment", { title: "Synthetic work", owner: member.name });
  const receipt = run(acme, member, "action.record", { assignment: a.key, action: "deploy", detail: "Attempt observed", phase: "attempted" }, "immutable-receipt-1") as { key: string };
  const original = need(acme, receipt.key).assertion!;
  for (const set of [{ phase: "reported" }, { type: "outcome" }, { detail: "Succeeded" }, { action: "ads" }, { amount: 1 }, { actor: colleague.name }, { at: "tomorrow" }, { payload: {} }, { target_rev: 9 }, { external_verified: true }]) {
    assert.throws(() => patch(acme, colleague, receipt.key, set), /immutable/);
  }
  patch(acme, colleague, receipt.key, { title: "Organizational label", metadata: { reason: "Grouping" } });
  run(acme, colleague, "record.undo", { ref: receipt.key });
  run(acme, colleague, "record.archive", { ref: receipt.key });
  run(acme, colleague, "record.restore", { ref: receipt.key });
  assert.deepEqual(need(acme, receipt.key).assertion, original);
  assert.equal(need(acme, receipt.key).body.phase, "attempted");
  const corrected = run(acme, colleague, "journal.correct", { ref: receipt.key, title: "Later report", phase: "reported" }, "immutable-correction-1") as Rec;
  assert.equal(corrected.assertion!.actor, colleague.name);
  assert.equal(corrected.assertion!.correction_of, need(acme, receipt.key).id);
  assert.equal(corrected.assertion!.target_rev, need(acme, receipt.key).rev);
  assert.equal(corrected.body.external_verified, false);
  assert.deepEqual(run(acme, colleague, "journal.correct", { ref: receipt.key, title: "Later report", phase: "reported" }, "immutable-correction-1"), corrected, "idempotent append");
  assert.throws(() => run(acme, colleague, "journal.correct", { ref: receipt.key, title: "Different" }, "immutable-correction-1"), /different|reuse/i);
  assert.throws(() => run(acme, viewer, "journal.correct", { ref: receipt.key, title: "Denied" }), /member/);
  assert.throws(() => run(other, colleague, "journal.correct", { ref: receipt.key, title: "Denied" }), /no record/);
  assert.throws(() => create(acme, colleague, "entry", { title: "Forged binding", target_rev: 1 }), /server-controlled/);
  assert.throws(() => acme.run("update journal_assertions set phase = 'reported' where record_id = ?", need(acme, receipt.key).id), /append-only/);
  assert.throws(() => acme.run("delete from journal_assertions where record_id = ?", need(acme, receipt.key).id), /append-only/);
  const journal = run(acme, colleague, "journal.list", {}) as JournalItem[];
  assert.deepEqual([journal.find((x) => x.key === receipt.key)!.phase, journal.find((x) => x.key === receipt.key)!.by, journal.find((x) => x.key === receipt.key)!.title], ["attempted", member.name, "Attempt observed"]);
  const shown = run(acme, colleague, "assignment.show", { ref: a.key }) as { actions: { phase: string; by: string }[] };
  assert.ok(shown.actions.some((x) => x.phase === "attempted" && x.by === member.name));
  // Even a corrupted editable body cannot reclassify an existing event assertion.
  acme.run("update records set body = json_set(body, '$.phase', 'reported', '$.type', 'outcome') where id = ?", need(acme, receipt.key).id);
  assert.equal(need(acme, receipt.key).body.phase, "attempted");
  assert.equal((run(acme, colleague, "journal.list", { type: "action" }) as JournalItem[]).find((x) => x.key === receipt.key)!.phase, "attempted");
});

test("new review notes bind server snapshot; later state and undo never inherit a review", (t) => {
  const { acme } = setup(t); addAgent(acme, member.name); addAgent(acme, colleague.name);
  const a = create(acme, member, "assignment", { title: "Review snapshot", owner: member.name, status: "done", result: "Original" });
  run(acme, colleague, "assignment.review", { ref: a.key, note: "Observed original" });
  const entry = (run(acme, member, "journal.list", { type: "note" }) as JournalItem[])[0]!;
  assert.deepEqual([entry.assertion!.target_record_id, entry.assertion!.target_rev, entry.assertion!.actor], [a.id, a.rev, colleague.name]);
  const saved = entry.assertion;
  patch(acme, colleague, a.key, { status: "in_progress" });
  run(acme, colleague, "record.undo", { ref: a.key });
  assert.equal((run(acme, member, "assignment.show", { ref: a.key }) as Assignment).verification.state, "not_verified");
  assert.deepEqual(need(acme, entry.key).assertion, saved);
});

test("eligible work is filtered before limits and paginated past 1000 newer closed or other-owner records", (t) => {
  const { acme } = setup(t); addAgent(acme, member.name); addAgent(acme, colleague.name);
  const p = create(acme, admin, "project", { title: "Synthetic project", status: "active" });
  const open = ["queued", "in_progress", "blocked", "needs_permission"].map((status) => create(acme, member, "assignment", { title: status, owner: member.name, project_id: p.id, status }));
  // Fixed timestamps exercise stable cursor tie-breaking, independent of clock resolution.
  for (const r of open) acme.run("update records set updated_at = '2026-01-01T00:00:00Z' where id = ?", r.id);
  acme.tx(() => {
    for (let n = 0; n < 1005; n++) {
      const r = create(acme, colleague, "assignment", { title: `New closed ${n}`, owner: colleague.name, status: n % 2 ? "done" : "cancelled" });
      acme.run("update records set updated_at = '2026-02-01T00:00:00Z' where id = ?", r.id);
    }
    for (let n = 0; n < 12; n++) create(acme, colleague, "assignment", { title: `Other owner ${n}`, owner: colleague.name });
  });
  type Page = Assignment & { cursor: string };
  const input = { owner: member.name, project: p.key, limit: 2 };
  const first = run(acme, member, "assignment.list", input) as Page[];
  const second = run(acme, member, "assignment.list", { ...input, after: first.at(-1)!.cursor }) as Page[];
  assert.deepEqual([...first, ...second].map((r) => r.key).sort(), open.map((r) => r.key).sort());
  assert.equal((run(acme, member, "assignment.list", { ...input, after: second.at(-1)!.cursor }) as Page[]).length, 0);
  const today = run(acme, member, "today.get", input) as { open_work: Page[]; needs_you: Page[] };
  const today2 = run(acme, member, "today.get", { ...input, after: today.open_work.at(-1)!.cursor }) as typeof today;
  assert.deepEqual([...today.open_work, ...today2.open_work].map((r) => r.key).sort(), open.map((r) => r.key).sort());
  assert.deepEqual(today.needs_you.map((r) => r.status).sort(), ["blocked", "needs_permission"]);
  const claimed = run(acme, member, "assignment.next", {}) as { assignment: Assignment };
  assert.equal(claimed.assignment.key, open[0]!.key);
  assert.equal(claimed.assignment.status, "picked_up");
  assert.throws(() => run(acme, member, "assignment.list", { after: "malformed" }), /cursor/);
});

test("later organizational relinks preserve original subject and snapshot in Journal and both assignments", (t) => {
  const { acme } = setup(t); addAgent(acme, member.name);
  const a = create(acme, member, "assignment", { title: "Original subject", owner: member.name });
  const b = create(acme, member, "assignment", { title: "Later grouping", owner: member.name });
  const receipt = run(acme, member, "action.record", { assignment: a.key, action: "deploy", detail: "Attempt about original", phase: "attempted" }) as { key: string };
  patch(acme, member, receipt.key, { assignment_id: b.key, about_id: b.key });
  patch(acme, member, a.key, { title: "New current label" });
  const event = (run(acme, member, "journal.list", {}) as JournalItem[])[0]!;
  assert.deepEqual(event.assertion_context!.original_target, { key: a.key, kind: "assignment", title: "Original subject", rev: 1 });
  assert.equal(event.assignment, b.key);
  assert.equal(event.assertion_context!.original_assignment!.key, a.key);
  assert.deepEqual(event.assertion_context!.relinked, ["about", "assignment"]);
  type Shown = { actions: { key: string; phase: string; assertion_context: NonNullable<Rec["assertion_context"]>; organizational_assignment: string }[] };
  for (const ref of [a.key, b.key]) {
    const show = run(acme, member, "assignment.show", { ref }) as Shown;
    assert.equal(show.actions[0]!.key, receipt.key);
    assert.equal(show.actions[0]!.phase, "attempted");
    assert.equal(show.actions[0]!.assertion_context.original_target!.key, a.key);
    assert.equal(show.actions[0]!.assertion_context.original_target!.rev, 1);
    assert.equal(show.actions[0]!.organizational_assignment, b.key);
  }
  const current = need(acme, receipt.key);
  assert.deepEqual(current.assertion_context, event.assertion_context);
});

test("Journal and Today filter immutable event time before limits despite 1000 newer metadata edits", (t) => {
  const { acme } = setup(t); const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: now - 30 * 86400000 });
  const old = acme.tx(() => Array.from({ length: 1005 }, (_, n) => create(acme, member, "entry", { type: "outcome", title: `Old result ${n}` })));
  t.mock.timers.setTime(now);
  const recent = create(acme, member, "entry", { type: "outcome", title: "Recent result must remain visible" });
  t.mock.timers.setTime(now + 10000);
  acme.tx(() => { for (const r of old) patch(acme, member, r.key, { title: "Edited old metadata" }); });
  t.mock.timers.reset();
  const journal = run(acme, member, "journal.list", { type: "outcome", since: "24h", limit: 1 }) as JournalItem[];
  assert.deepEqual(journal.map((r) => r.key), [recent.key]);
  const today = run(acme, member, "today.get", {}) as { results: JournalItem[] };
  assert.deepEqual(today.results.map((r) => r.key), [recent.key]);
  assert.equal((run(acme, member, "journal.list", { type: "outcome", limit: 1 }) as JournalItem[])[0]!.key, recent.key);
});
