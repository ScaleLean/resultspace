// Schema 2 -> 3: work orders become assignments. The fixture is a company file written the way schema 2
// stored it (kind work_order, keys WO-..., Journal entries with work_order_id), row by row, then opened.
import { createHash } from "node:crypto";
import { stable } from "../src/core/records.ts";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Actor } from "../src/core/agents.ts";
import { addAgent } from "../src/core/agents.ts";
import { Companies } from "../src/core/companies.ts";
import { companyFile } from "../src/core/company.ts";
import { NodeDb } from "../src/core/db.ts";
import { RsError } from "../src/core/errors.ts";
import type { Rec, Revision } from "../src/core/records.ts";
import { BUILTIN_KINDS, DDL, UPGRADES } from "../src/core/schema.ts";
import type { Assignment, Order } from "../src/operations/assignments.ts";
import { run } from "../src/operations/index.ts";
import type { JournalItem } from "../src/operations/views.ts";
import { setup } from "./helpers.ts";

const admin: Actor = { kind: "person", name: "alex", role: "admin" };
const agent: Actor = { kind: "agent", name: "hermes:acme", role: "member" };
const stranger: Actor = { kind: "agent", name: "hermes:else", role: "member" };
const code = (c: string) => (e: unknown) => e instanceof RsError && e.code === c;

// Schema 2's built-in kinds: today's, with the assignment kind under its old name.
const V2_KINDS = BUILTIN_KINDS.map((k) =>
  k.kind === "assignment" ? { ...k, kind: "work_order", prefix: "WO", statuses: k.statuses?.filter((s) => s !== "blocked") ?? null }
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
  db.exec("drop table historical_reviews; drop table journal_assertions; drop index records_by_status; drop table evidence_authority; alter table ops drop column outcome_schema");
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
      ops: db.all<Record<string, unknown>>("select op_id, actor, request_hash, outcome, at from ops"),
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

  assert.equal(after.version, "7");
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
  run(acme, stranger, "assignment.start", { ref: "WO-0002" });
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
  assert.equal(again.get("acme").one<{ v: string }>("select v from meta where k = 'schema_version'")?.v, "7");
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


for (const version of [3, 4, 5]) test(`schema ${version} -> 6 retains evidence and allows shared edits after disposable backup/restore`, (t) => {
  const { dir, companies } = world(t);
  const db = new NodeDb(companyFile(dir, "acme"));
  db.tx(() => {
    (UPGRADES[3] as (db: NodeDb) => void)(db);
    if (version >= 4) {
      db.exec(UPGRADES[4] as string);
      // Populated authority metadata, including a stale reference, is deliberately inert.
      db.run("insert into evidence_authority values (?, ?)", ID.outcome, JSON.stringify([ID.done, "stale-assignment"]));
    }
    if (version === 5) (UPGRADES[5] as (db: NodeDb) => void)(db);
    const prior = db.one<{ body: string; rev: number }>("select body, rev from records where id = ?", ID.done)!;
    const body = JSON.stringify({ ...JSON.parse(prior.body), verification: "verified", verified_by: "historical-reviewer", verified_at: "2026-09-05T12:00:00.000Z", verification_note: "Historical check" });
    db.run("update records set body = ?, rev = ?, updated_at = '2026-09-05T12:00:00.000Z', updated_by = 'historical-reviewer' where id = ?", body, prior.rev + 1, ID.done);
    db.run("insert into revisions (record_id, rev, body, archived, changed, op, actor, actor_kind, at) values (?, ?, ?, 0, ?, 'patch', 'historical-reviewer', 'person', '2026-09-05T12:00:00.000Z')", ID.done, prior.rev + 1, body, JSON.stringify(["verification", "verified_by", "verified_at", "verification_note"]));
    db.run("update meta set v = ? where k = 'schema_version'", String(version));
  });
  db.exec("pragma wal_checkpoint(truncate)"); db.close();
  const before = snapshot(dir);
  const backupDir = join(dir, "before"); mkdirSync(backupDir);
  copyFileSync(companyFile(dir, "acme"), companyFile(backupDir, "acme"));
  const co = companies.get("acme");
  const after = snapshot(dir);
  assert.equal(after.version, "7");
  for (const field of ["records", "revisions", "ops", "counters"] as const) assert.deepEqual(after[field], before[field]);
  const authority = co.all("select * from evidence_authority");
  assert.equal(authority.length, version >= 4 ? 1 : 0);
  const historical = (run(co, stranger, "assignment.show", { ref: "WO-0001" }) as Assignment).verification;
  assert.equal(historical.state, "verified");
  run(co, stranger, "assignment.verify", { ref: "WO-0001", verdict: "disputed", note: "Review opinion" });
  assert.deepEqual((run(co, stranger, "assignment.show", { ref: "WO-0001" }) as Assignment).verification, historical);
  const beforeEvidence = run(co, stranger, "record.history", { ref: "WO-0001" });
  run(co, stranger, "record.patch", { ref: "WO-0001", set: { status: "in_progress" } });
  assert.equal((run(co, stranger, "assignment.show", { ref: "WO-0001" }) as Assignment).verification.state, "not_verified");
  run(co, stranger, "record.undo", { ref: "WO-0001" });
  assert.equal((run(co, stranger, "assignment.show", { ref: "WO-0001" }) as Assignment).verification.state, "not_verified", "undo creates a new snapshot, not the old review binding");
  run(co, stranger, "record.archive", { ref: "WO-0001" });
  run(co, stranger, "record.restore", { ref: "WO-0001" });
  const show = run(co, stranger, "assignment.show", { ref: "WO-0001" }) as Assignment;
  assert.equal(show.verification.state, "not_verified");
  assert.equal(show.historical_reviews[0]?.target_rev, 5);
  assert.deepEqual((run(co, stranger, "record.history", { ref: "WO-0001" }) as Revision[]).slice(0, 5), beforeEvidence);
  assert.throws(() => co.run("update historical_reviews set target_rev = 9"), /append-only/);
  run(co, stranger, "record.patch", { ref: "JNL-0001", set: { title: "Shared edit" } });
  run(co, stranger, "record.archive", { ref: "JNL-0001" });
  run(co, agent, "record.restore", { ref: "JNL-0001" });
  run(co, stranger, "record.undo", { ref: "JNL-0001" });
  run(co, stranger, "record.patch", { ref: "WO-0002", set: { owner: stranger.name } });
  run(co, agent, "assignment.report", { ref: "WO-0002", result: "Shared report" });
  assert.deepEqual(co.all("select * from evidence_authority"), authority);
  co.run("pragma wal_checkpoint(truncate)"); companies.close();
  const restoredDir = join(dir, "restored"); mkdirSync(restoredDir);
  copyFileSync(companyFile(dir, "acme"), companyFile(restoredDir, "acme"));
  const restored = new Companies(restoredDir); t.after(() => restored.close());
  run(restored.get("acme"), stranger, "record.restore", { ref: "JNL-0001" });
  run(restored.get("acme"), stranger, "record.patch", { ref: "JNL-0001", set: { title: "Still shared" } });
  assert.deepEqual(restored.get("acme").all("select * from evidence_authority"), authority);
  assert.deepEqual(snapshot(backupDir), before, "pre-upgrade backup restores the complete prior data");
});


test("schema 5 assertion migration uses earliest preserved assertion; ambiguous legacy evidence stays unbound", (t) => {
  const { dir, companies } = world(t);
  const db = new NodeDb(companyFile(dir, "acme"));
  db.tx(() => {
    (UPGRADES[3] as (db: NodeDb) => void)(db); db.exec(UPGRADES[4] as string); (UPGRADES[5] as (db: NodeDb) => void)(db);
    // A legacy attempt was rewritten into a reported action, with actor/time-shaped client fields.
    const original = JSON.parse(db.one<{ body: string }>("select body from revisions where record_id = ? and rev = 1", ID.action)!.body);
    original.phase = "attempted";
    // Building the old fixture only, before its append-only history triggers are enabled again.
    db.exec("drop trigger revisions_no_update");
    db.run("update revisions set body = ? where record_id = ? and rev = 1", JSON.stringify(original), ID.action);
    db.exec("create trigger revisions_no_update before update on revisions begin select raise(abort, 'revisions are append-only'); end");
    const edited = JSON.stringify({ ...original, phase: "reported", title: "Later changed claim", actor: "invented", at: "invented" });
    db.run("update records set body = ?, rev = 2, updated_by = ? where id = ?", edited, stranger.name, ID.action);
    db.run("insert into revisions (record_id, rev, body, archived, changed, op, actor, actor_kind, at) values (?, 2, ?, 0, ?, 'patch', ?, 'agent', '2026-09-06')", ID.action, edited, JSON.stringify(["phase", "title"]), stranger.name);
    const done = JSON.parse(db.one<{ body: string }>("select body from records where id = ?", ID.done)!.body);
    const unbound = JSON.stringify({ ...done, verification: "verified", verified_by: "claimed-reviewer", verified_at: "invented", verification_note: "Imported review claim" });
    db.run("update records set body = ?, rev = 5 where id = ?", unbound, ID.done);
    db.run("insert into revisions (record_id, rev, body, archived, changed, op, actor, actor_kind, at) values (?, 5, ?, 0, '[]', 'patch', ?, 'agent', '2026-09-06')", ID.done, unbound, agent.name);
    // Imported notes and old actions without phase cannot become trusted assertions.
    db.run("insert into records (id, key, kind, rev, body, archived, created_at, updated_at, updated_by) values ('legacy-ambiguous', 'JNL-0099', 'entry', 1, ?, 0, '2026-09-01', '2026-09-01', 'invented')", JSON.stringify({ type: "action", phase: "reported", title: "Imported claim" }));
    db.run("update meta set v = '5' where k = 'schema_version'");
  }); db.close();
  const before = snapshot(dir); const co = companies.get("acme");
  const after = snapshot(dir);
  assert.deepEqual(after.records, before.records); assert.deepEqual(after.revisions, before.revisions);
  const event = run(co, stranger, "record.get", { ref: "JNL-0002" }) as Rec;
  assert.deepEqual([event.body.phase, event.assertion!.actor, event.assertion!.at, event.assertion!.payload.title], ["attempted", agent.name, "2026-09-03T11:40:00.000Z", "Paused campaign 12"]);
  run(co, stranger, "record.undo", { ref: event.key });
  run(co, stranger, "record.archive", { ref: event.key }); run(co, stranger, "record.restore", { ref: event.key });
  assert.equal((run(co, stranger, "record.get", { ref: event.key }) as Rec).body.phase, "attempted");
  const ambiguous = run(co, stranger, "record.get", { ref: "JNL-0099" }) as Rec;
  assert.deepEqual([ambiguous.body.type, ambiguous.body.phase, ambiguous.assertion!.binding, ambiguous.assertion!.actor], ["unknown", "unknown", "legacy_unbound", "unknown"]);
  const review = run(co, stranger, "assignment.show", { ref: "WO-0001" }) as Assignment;
  assert.equal(review.verification.state, "not_verified");
  assert.deepEqual([review.historical_reviews[0]!.binding, review.historical_reviews[0]!.target_rev], ["legacy_unbound", null]);
  const sessions = run(co, stranger, "journal.list", {}) as JournalItem[];
  assert.equal(sessions.find((x) => x.key === event.key)!.phase, "attempted");
});


test("schema 6 migration failure rolls back its own tables and preserves schema 5 data", (t) => {
  const { dir, companies } = world(t); const db = new NodeDb(companyFile(dir, "acme"));
  db.tx(() => {
    (UPGRADES[3] as (db: NodeDb) => void)(db); db.exec(UPGRADES[4] as string); (UPGRADES[5] as (db: NodeDb) => void)(db);
    db.run("update meta set v = '5' where k = 'schema_version'");
    // Deliberate index collision occurs after table creation, exercising transactional rollback.
    db.exec("create index records_by_status on records(key)");
  }); db.close();
  const before = snapshot(dir);
  assert.throws(() => companies.get("acme"), /already exists/);
  assert.deepEqual(snapshot(dir), before);
  const inspect = new NodeDb(companyFile(dir, "acme"), { readOnly: true });
  assert.equal(inspect.one("select name from sqlite_master where name = 'journal_assertions'"), undefined);
  assert.equal(inspect.one("select name from sqlite_master where name = 'historical_reviews'"), undefined);
  inspect.close();
});


for (const version of [2, 3, 4, 5]) for (const ambiguous of ["self", "time", "actor"] as const) test(`schema ${version} keeps ${ambiguous} legacy review historical/unbound`, (t) => {
  const { dir, companies } = world(t); const db = new NodeDb(companyFile(dir, "acme"));
  db.tx(() => {
    if (version >= 3) (UPGRADES[3] as (db: NodeDb) => void)(db);
    if (version >= 4) db.exec(UPGRADES[4] as string);
    if (version >= 5) (UPGRADES[5] as (db: NodeDb) => void)(db);
    const actor = ambiguous === "self" ? agent.name : ambiguous === "actor" ? "unknown" : "reviewer";
    const at = ambiguous === "time" ? "2026-09-05" : "2026-09-05T12:00:00.000Z";
    const current = JSON.parse(db.one<{ body: string }>("select body from records where id = ?", ID.done)!.body);
    const body = JSON.stringify({ ...current, verification: "verified", verified_by: actor, verified_at: at, verification_note: "Legacy evidence" });
    db.run("update records set body = ?, rev = 5 where id = ?", body, ID.done);
    db.run("insert into revisions (record_id, rev, body, archived, changed, op, actor, actor_kind, at) values (?, 5, ?, 0, '[]', 'patch', ?, 'person', ?)", ID.done, body, actor, at);
    db.run("update meta set v = ? where k = 'schema_version'", String(version));
  }); db.close(); const before = snapshot(dir); const co = companies.get("acme");
  const current = run(co, stranger, "assignment.show", { ref: "WO-0001" }) as Assignment;
  assert.equal(current.verification.state, "not_verified");
  assert.deepEqual([current.historical_reviews[0]!.binding, current.historical_reviews[0]!.target_rev], ["legacy_unbound", null]);
  assert.deepEqual(snapshot(dir).revisions, before.revisions);
  assert.deepEqual(snapshot(dir).records, before.records);
});

test("legacy idempotency replay after migration is historical/unbound and never executes or returns cached claims", (t) => {
  const { dir, companies } = world(t); const db = new NodeDb(companyFile(dir, "acme"));
  const cases = [
    { id: "legacy-patch-replay-1", name: "record.patch", input: { ref: "JNL-0002", set: { phase: "reported" } }, outcome: { key: "JNL-0002", body: { phase: "reported" } } },
    { id: "legacy-review-replay-1", name: "assignment.verify", input: { ref: "WO-0001", verdict: "verified" }, outcome: { key: "WO-0001", verification: { state: "verified" } } },
  ];
  db.tx(() => {
    (UPGRADES[3] as (db: NodeDb) => void)(db); db.exec(UPGRADES[4] as string); (UPGRADES[5] as (db: NodeDb) => void)(db);
    for (const c of cases) db.run("insert into ops (op_id, actor, request_hash, outcome, at) values (?, ?, ?, ?, '2026-09-05')", c.id, agent.name,
      createHash("sha256").update(`${c.name}\n${stable(c.input)}`).digest("hex"), JSON.stringify(c.outcome));
    db.run("update meta set v = '5' where k = 'schema_version'");
  }); db.close(); const co = companies.get("acme"); const before = snapshot(dir);
  for (const c of cases) {
    const response = run(co, agent, c.name, c.input, c.id) as Record<string, unknown>;
    assert.deepEqual([response.replayed, response.executed, response.historical, response.legacy_outcome_unbound], [true, false, true, true]);
    assert.equal(response.body, undefined); assert.equal(response.verification, undefined);
    assert.deepEqual(run(co, agent, c.name, c.input, c.id), response);
    assert.throws(() => run(co, stranger, c.name, c.input, c.id), /different request/);
  }
  const after = snapshot(dir);
  assert.deepEqual(after, before, "replay changes neither records, revisions nor operation ledger");
  assert.equal((run(co, agent, "assignment.show", { ref: "WO-0001" }) as Assignment).verification.state, "not_verified");
  assert.notEqual((run(co, agent, "record.get", { ref: "JNL-0002" }) as Rec).body.phase, "reported");
});
