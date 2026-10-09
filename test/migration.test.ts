// Schema 2 -> 3: work orders become assignments. The fixture is a company file written the way schema 2
// stored it (kind work_order, keys WO-..., Journal entries with work_order_id), row by row, then opened.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Actor } from "../src/core/agents.ts";
import { Companies } from "../src/core/companies.ts";
import { companyFile } from "../src/core/company.ts";
import { NodeDb } from "../src/core/db.ts";
import { RsError } from "../src/core/errors.ts";
import type { Rec, Revision } from "../src/core/records.ts";
import { BUILTIN_KINDS, DDL } from "../src/core/schema.ts";
import type { Assignment, Order } from "../src/operations/assignments.ts";
import { run } from "../src/operations/index.ts";
import type { JournalItem } from "../src/operations/views.ts";

const admin: Actor = { kind: "person", name: "alex", role: "admin" };
const agent: Actor = { kind: "agent", name: "hermes:acme", role: "member" };
const stranger: Actor = { kind: "agent", name: "hermes:else", role: "member" };
const code = (c: string) => (e: unknown) => e instanceof RsError && e.code === c;

// Schema 2's built-in kinds: today's, with the assignment kind under its old name.
const V2_KINDS = BUILTIN_KINDS.map((k) =>
  k.kind === "assignment" ? { ...k, kind: "work_order", prefix: "WO" }
  : k.kind === "entry" ? { ...k, refs: { about_id: null, project_id: "project", work_order_id: "work_order" } } : k);

const ID = {
  project: "0190a000-0000-7000-8000-000000000001", imported: "0190a000-0000-7000-8000-000000000002", done: "0190a000-0000-7000-8000-000000000003",
  open: "0190a000-0000-7000-8000-000000000004", outcome: "0190a000-0000-7000-8000-000000000005", action: "0190a000-0000-7000-8000-000000000006",
  session: "0190a000-0000-7000-8000-000000000007", note: "0190a000-0000-7000-8000-000000000008",
};
type Body = Record<string, unknown>;
type Version = { body: Body; at: string; by: string; op?: string; why?: string };

/** A schema-2 company file: an open work order, a finished one, an imported one, and linked outcome/action/session entries. */
function schema2File(dir: string, slug: string, extraKinds: { kind: string; prefix: string }[] = []) {
  const db = new NodeDb(companyFile(dir, slug));
  db.exec(DDL);
  for (const [k, v] of [["slug", slug], ["name", "Acme"], ["schema_version", "2"], ["created_at", "2026-09-01T00:00:00.000Z"]]) db.run("insert into meta (k, v) values (?, ?)", k!, v!);
  for (const k of [...V2_KINDS, ...extraKinds.map((x) => ({ ...x, title_field: "title", statuses: null, refs: {} }))])
    db.run("insert into kinds (kind, prefix, title_field, statuses, refs) values (?, ?, ?, ?, ?)", k.kind, k.prefix, k.title_field, k.statuses ? JSON.stringify(k.statuses) : null, JSON.stringify(k.refs));
  db.run("insert into agents (name, role, active, created_at) values ('hermes:acme', 'member', 1, '2026-09-01T00:00:00.000Z')");
  db.run("insert into agents (name, role, active, created_at) values ('hermes:else', 'member', 1, '2026-09-01T00:00:00.000Z')");
  const put = (id: string, key: string, kind: string, versions: Version[]) => {
    const last = versions.at(-1)!;
    db.run("insert into records (id, key, kind, rev, body, archived, created_at, updated_at, updated_by) values (?, ?, ?, ?, ?, 0, ?, ?, ?)",
      id, key, kind, versions.length, JSON.stringify(last.body), versions[0]!.at, last.at, last.by);
    let prev: Body = {};
    versions.forEach((v, i) => {
      const changed = [...new Set([...Object.keys(prev), ...Object.keys(v.body)])].filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(v.body[f])).sort();
      db.run("insert into revisions (record_id, rev, body, archived, changed, op, op_id, actor, actor_kind, at, why) values (?, ?, ?, 0, ?, ?, null, ?, ?, ?, ?)",
        id, i + 1, JSON.stringify(v.body), JSON.stringify(changed), v.op ?? (i ? "patch" : "create"), v.by, v.by === "alex" ? "person" : "agent", v.at, v.why ?? null);
      prev = v.body;
    });
    db.run("insert into records_fts (id, key, title, body) values (?, ?, ?, ?)", id, key, String(last.body.title ?? key), Object.values(last.body).filter((x) => typeof x === "string").join("\n"));
  };
  const link = (from: string, to: string, label: string) => db.run("insert into links (from_id, to_id, label) values (?, ?, ?)", from, to, label);

  put(ID.project, "PRJ-0001", "project", [{ body: { title: "Launch", status: "active" }, at: "2026-09-01T10:00:00.000Z", by: "alex" }]);
  // Imported from the old system with a three-digit key, finished long ago.
  put(ID.imported, "WO-001", "work_order", [{ body: { title: "Old audit", owner: "curator", status: "done", result: "Audit filed" }, at: "2026-08-01T10:00:00.000Z", by: "import", op: "import" }]);
  const done = { title: "Check label", owner: "hermes:acme", brief: "Compare with the formula", project_id: ID.project };
  put(ID.done, "WO-0001", "work_order", [
    { body: { ...done, status: "queued" }, at: "2026-09-02T10:00:00.000Z", by: "alex" },
    { body: { ...done, status: "picked_up" }, at: "2026-09-02T11:00:00.000Z", by: "hermes:acme" },
    { body: { ...done, status: "in_progress" }, at: "2026-09-02T11:05:00.000Z", by: "hermes:acme" },
    { body: { ...done, status: "done", result: "Label matches the formula" }, at: "2026-09-02T12:00:00.000Z", by: "hermes:acme" },
  ]);
  const open = { title: "Pause dead campaigns", owner: "hermes:acme", brief: "Pause campaigns with spend and no sales", due_on: "2026-12-01" };
  put(ID.open, "WO-0002", "work_order", [
    { body: { ...open, status: "queued" }, at: "2026-09-03T10:00:00.000Z", by: "alex" },
    { body: { ...open, status: "picked_up" }, at: "2026-09-03T11:00:00.000Z", by: "hermes:acme" },
    { body: { ...open, status: "in_progress", progress: "Listed 3 campaigns" }, at: "2026-09-03T11:30:00.000Z", by: "hermes:acme" },
  ]);
  put(ID.outcome, "JNL-0001", "entry", [{ body: { type: "outcome", title: "Label matches the formula", about_id: ID.done, project_id: ID.project, work_order_id: ID.done }, at: "2026-09-02T12:00:00.000Z", by: "hermes:acme" }]);
  put(ID.action, "JNL-0002", "entry", [{ body: { type: "action", title: "Paused campaign 12", action: "ads", about_id: ID.open, work_order_id: ID.open }, at: "2026-09-03T11:40:00.000Z", by: "hermes:acme" }]);
  put(ID.session, "JNL-0003", "entry", [{ body: { type: "session", title: "3 steps: ads API ok", session: "s1", about_id: ID.open, work_order_id: ID.open }, at: "2026-09-03T11:45:00.000Z", by: "hermes:acme" }]);
  put(ID.note, "JNL-0004", "entry", [{ body: { type: "note", title: "See WO-0001 for the label check" }, at: "2026-09-04T09:00:00.000Z", by: "alex" }]);
  link(ID.done, ID.project, "project");
  for (const [from, to] of [[ID.outcome, ID.done], [ID.action, ID.open], [ID.session, ID.open]] as const) { link(from, to, "about"); link(from, to, "work_order"); }
  link(ID.outcome, ID.project, "project");
  link(ID.note, ID.done, "cites");
  for (const [p, n] of [["PRJ", 2], ["WO", 3], ["JNL", 5]] as const) db.run("insert into key_counters (prefix, next_n) values (?, ?)", p, n);
  db.run("insert into ops (op_id, actor, request_hash, outcome, at) values ('op-claim-0001', 'hermes:acme', 'h', ?, '2026-09-03T11:00:00.000Z')",
    JSON.stringify({ work_order: { key: "WO-0002", status: "picked_up" }, claimed: true }));
  db.close();
}

function world(t: TestContext, extraKinds: { kind: string; prefix: string }[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "rs-mig-"));
  schema2File(dir, "acme", extraKinds);
  const companies = new Companies(dir);
  t.after(() => { companies.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, companies };
}

/** Everything the upgrade must not change, read straight from the file. */
const snapshot = (dir: string) => {
  const db = new NodeDb(companyFile(dir, "acme"), { readOnly: true });
  try {
    return {
      records: db.all<Record<string, unknown>>("select id, key, rev, created_at, updated_at, updated_by, archived, json_remove(body, '$.work_order_id', '$.assignment_id') as body from records order by key"),
      revisions: db.all<Record<string, unknown>>("select * from revisions order by seq"),
      ops: db.all<Record<string, unknown>>("select * from ops"),
      counters: db.all<Record<string, unknown>>("select * from key_counters order by prefix"),
      version: db.one<{ v: string }>("select v from meta where k = 'schema_version'")?.v,
    };
  } finally { db.close(); }
};

test("migration 2 -> 3: work orders become assignments with ids, keys, revisions, history, owners, results and links kept", (t) => {
  const { dir, companies } = world(t);
  const before = snapshot(dir);
  assert.equal(before.version, "2");
  const acme = companies.get("acme"); // opening the file runs the upgrade
  const after = snapshot(dir);

  assert.equal(after.version, "3");
  assert.deepEqual(after.records, before.records, "ids, keys, revisions, times, authors and every other field stay as they were");
  assert.deepEqual(after.revisions, before.revisions, "history is untouched (append-only), old bodies included");
  assert.deepEqual(after.ops, before.ops, "the op ledger is untouched");
  assert.deepEqual(after.counters, before.counters, "the WO counter stays; ASG starts fresh");

  assert.deepEqual(acme.all<{ kind: string; prefix: string }>("select kind, prefix from kinds where kind in ('work_order', 'assignment')").map((k) => [k.kind, k.prefix]), [["assignment", "ASG"]]);
  assert.deepEqual(JSON.parse(acme.one<{ refs: string }>("select refs from kinds where kind = 'entry'")!.refs), { about_id: null, project_id: "project", assignment_id: "assignment" });
  assert.deepEqual(acme.all<{ key: string; kind: string }>("select key, kind from records where key like 'WO-%' order by key").map((r) => [r.key, r.kind]),
    [["WO-0001", "assignment"], ["WO-0002", "assignment"], ["WO-001", "assignment"]]);
  const entries = run(acme, admin, "record.list", { kind: "entry", archived: "all" }) as Rec[];
  const assignmentOfEntry = new Map(entries.map((e) => [e.key, e.body.assignment_id]));
  assert.deepEqual(Object.fromEntries(assignmentOfEntry), { "JNL-0001": ID.done, "JNL-0002": ID.open, "JNL-0003": ID.open, "JNL-0004": undefined });
  assert.ok(entries.every((e) => !("work_order_id" in e.body)));
  assert.deepEqual(acme.all<{ label: string; n: number }>("select label, count(*) as n from links group by label order by label").map((l) => [l.label, l.n]),
    [["about", 3], ["assignment", 3], ["cites", 1], ["project", 2]]);
  const summary = JSON.parse(acme.one<{ v: string }>("select v from meta where k = 'upgrade_3'")!.v) as Record<string, unknown>;
  assert.deepEqual([summary.assignments, summary.relinked, summary.links, summary.kinds], [3, 3, 3, ["entry"]]);

  // Old keys resolve everywhere, through the new and the old operations.
  const done = run(acme, agent, "assignment.show", { ref: "WO-0001" }) as Assignment & { outcomes: { key: string }[]; sessions: unknown[]; actions: unknown[] };
  assert.deepEqual([done.kind, done.key, done.owner, done.status, done.status_words, done.result, done.project, done.rev], ["assignment", "WO-0001", "hermes:acme", "done", "Result reported", "Label matches the formula", "PRJ-0001", 4]);
  assert.deepEqual(done.outcomes.map((o) => o.key), ["JNL-0001"]);
  assert.equal(done.verification.state, "not_verified", "a result reported before the rename is still only reported");
  const open = run(acme, agent, "work.show", { ref: "wo-0002" }) as Order & { receipts: unknown[]; actions: unknown[] };
  assert.deepEqual([open.status, open.progress, open.due_on, open.receipts.length, open.actions.length], ["in_progress", "Listed 3 campaigns", "2026-12-01", 1, 1]);
  assert.equal((run(acme, agent, "record.get", { ref: "WO-001" }) as Rec).body.result, "Audit filed", "three-digit imported keys resolve too");
  assert.equal(run(acme, agent, "record.history", { ref: "WO-0001" }) instanceof Array && (run(acme, agent, "record.history", { ref: "WO-0001" }) as Revision[]).map((v) => v.body.status).join(","), "queued,picked_up,in_progress,done");
  assert.equal(((run(acme, agent, "record.links", { ref: "WO-0001" }) as { in: { key: string; label: string }[] }).in).map((l) => `${l.label}:${l.key}`).sort().join(" "), "about:JNL-0001 assignment:JNL-0001 cites:JNL-0004");
  const journal = run(acme, agent, "journal.list", { since: "2026-01-01T00:00:00.000Z" }) as JournalItem[];
  assert.deepEqual(journal.filter((j) => j.assignment).map((j) => [j.key, j.assignment, j.work_order]).sort(), [["JNL-0001", "WO-0001", "WO-0001"], ["JNL-0002", "WO-0002", "WO-0002"], ["JNL-0003", "WO-0002", "WO-0002"]]);
  assert.deepEqual((run(acme, agent, "assignment.list", {}) as Assignment[]).map((a) => a.key), ["WO-0002"]);
  assert.equal((run(acme, agent, "record.list", { kind: "work_order", archived: "all" }) as Rec[]).length, 3);
  assert.equal((run(acme, agent, "record.search", { q: "campaigns", kind: "work_order" }) as { key: string }[])[0]?.key, "WO-0002");

  // The open one carries on after the upgrade: owner only, then a report linked by assignment_id.
  assert.throws(() => run(acme, stranger, "assignment.report", { ref: "WO-0002", result: "x" }), code("forbidden"));
  run(acme, agent, "action.record", { action: "ads", detail: "Paused campaign 14", work_order: "WO-0002" });
  const reported = run(acme, agent, "assignment.report", { ref: "WO-0002", result: "Paused 3 campaigns that spent with no sales" }) as Assignment;
  assert.deepEqual([reported.key, reported.status, reported.rev, reported.reported_by], ["WO-0002", "done", 4, "hermes:acme"]);
  const shown = run(acme, agent, "assignment.show", { ref: "WO-0002" }) as Assignment & { outcomes: unknown[]; actions: unknown[]; sessions: unknown[] };
  assert.deepEqual([shown.outcomes.length, shown.actions.length, shown.sessions.length], [1, 2, 1]);

  // New assignments get ASG keys; WO is never handed out again.
  assert.equal((run(acme, admin, "record.create", { kind: "assignment", body: { title: "New one", owner: "hermes:acme" } }) as Rec).key, "ASG-0001");
  assert.equal((run(acme, admin, "record.create", { kind: "work_order", body: { title: "Old caller", owner: "hermes:acme" } }) as Rec).key, "ASG-0002");
  assert.equal(acme.one<{ next_n: number }>("select next_n from key_counters where prefix = 'WO'")?.next_n, 3);

  // Undo of a change made after the upgrade reads old revisions under the new field names.
  run(acme, admin, "record.patch", { ref: "JNL-0001", set: { assignment_id: "WO-0002" } });
  assert.equal((run(acme, admin, "record.undo", { ref: "JNL-0001" }) as Rec).body.assignment_id, ID.done);

  // The upgrade ran once: reopening changes nothing.
  companies.close();
  const again = new Companies(dir);
  t.after(() => again.close());
  assert.equal(again.get("acme").one<{ v: string }>("select v from meta where k = 'schema_version'")?.v, "3");
});

test("migration 2 -> 3 refuses, changing nothing, when the company already has an assignment kind or uses ASG", (t) => {
  for (const clash of [{ kind: "assignment", prefix: "ASN" }, { kind: "assessment", prefix: "ASG" }]) {
    const { dir, companies } = world(t, [clash]);
    const before = snapshot(dir);
    assert.throws(() => companies.get("acme"), /cannot make work orders into assignments/);
    const after = snapshot(dir);
    assert.deepEqual(after, before, `${clash.kind}/${clash.prefix}: the file stays at schema 2, untouched`);
  }
});

test("migration 2 -> 3 keeps companies apart: each file upgrades on its own and old keys never cross", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rs-mig-"));
  schema2File(dir, "acme");
  const companies = new Companies(dir);
  t.after(() => { companies.close(); rmSync(dir, { recursive: true, force: true }); });
  const other = companies.create("other-co", "Other Co");
  assert.throws(() => run(other, admin, "assignment.show", { ref: "WO-0001" }), code("not_found"));
  assert.equal((run(other, admin, "record.list", { kind: "assignment" }) as Rec[]).length, 0);
  assert.equal((run(companies.get("acme"), admin, "assignment.list", { all: true }) as Assignment[]).length, 3);
});
