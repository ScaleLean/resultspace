import assert from "node:assert/strict";
import { test } from "node:test";
import { RsError } from "../src/core/errors.ts";
import type { Hit, Link, Revision } from "../src/core/records.ts";
import { run } from "../src/operations/index.ts";
import { admin, member, rec, setup } from "./helpers.ts";

const code = (c: string) => (e: unknown) => e instanceof RsError && e.code === c;

test("create gives keys in order and keeps every version", (t) => {
  const { acme } = setup(t);
  const a = rec(acme, member, "record.create", { kind: "issue_note", body: { title: "Call supplier", status: "open" } });
  const b = rec(acme, member, "record.create", { kind: "issue_note", body: { title: "Send samples" } });
  assert.equal(a.key, "ISN-0001");
  assert.equal(b.key, "ISN-0002");
  const c = rec(acme, member, "record.patch", { ref: "ISN-0001", set: { status: "resolved", note: "ok" }, why: "supplier answered" });
  assert.equal(c.rev, 2);
  const d = rec(acme, member, "record.patch", { ref: a.id, set: { note: null } });
  assert.deepEqual(d.body, { title: "Call supplier", status: "resolved" });
  const h = run(acme, member, "record.history", { ref: "isn-0001" }) as Revision[];
  assert.deepEqual(
    h.map((v) => [v.rev, v.op, v.changed]),
    [
      [1, "create", ["status", "title"]],
      [2, "patch", ["note", "status"]],
      [3, "patch", ["note"]],
    ],
  );
  assert.equal(h[1]?.why, "supplier answered");
  assert.equal(h[1]?.actor, "hermes:acme");
});

test("a patch that changes nothing writes nothing", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "entry", body: { title: "A" } });
  const same = rec(acme, member, "record.patch", { ref: "JNL-0001", set: { title: "A" } });
  assert.equal(same.rev, 1);
});

test("base_rev refuses a write on a record that moved on", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "entry", body: { title: "A" } });
  rec(acme, member, "record.patch", { ref: "JNL-0001", set: { title: "B" } });
  assert.throws(() => run(acme, member, "record.patch", { ref: "JNL-0001", set: { title: "C" }, base_rev: 1 }), code("conflict"));
  assert.equal(rec(acme, member, "record.patch", { ref: "JNL-0001", set: { title: "C" }, base_rev: 2 }).rev, 3);
});

test("a kind checks its title, its statuses and its references", (t) => {
  const { acme } = setup(t);
  assert.throws(() => run(acme, member, "record.create", { kind: "issue_note", body: { status: "open" } }), code("invalid"));
  assert.throws(() => run(acme, member, "record.create", { kind: "issue_note", body: { title: "x", status: "someday" } }), code("invalid"));
  assert.throws(() => run(acme, member, "record.create", { kind: "widget", body: { title: "x" } }), code("invalid"));
  const project = rec(acme, member, "record.create", { kind: "project", body: { title: "Grow", status: "active" } });
  assert.throws(() => run(acme, member, "record.create", { kind: "issue_note", body: { title: "P", project_id: "PRJ-0099" } }), code("invalid"));
  const knowledge = rec(acme, member, "record.create", { kind: "knowledge", body: { title: "Learning" } });
  assert.throws(
    () => run(acme, member, "record.create", { kind: "issue_note", body: { title: "T", project_id: knowledge.key } }),
    /must point at a project/,
  );
  const p = rec(acme, member, "record.create", { kind: "issue_note", body: { title: "P", project_id: project.key } });
  assert.equal(p.body.project_id, project.id, "a reference given as a key is stored as the record id");
  // An id of something that is not a record here is left alone.
  const n = rec(acme, member, "record.create", { kind: "entry", body: { title: "W", conversation_id: "abc-123" } });
  assert.equal(n.body.conversation_id, "abc-123");
});

test("a reference to an archived record is refused, but old ones do not block edits", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "project", body: { title: "P" } });
  rec(acme, member, "record.create", { kind: "issue_note", body: { title: "T", project_id: "PRJ-0001" } });
  rec(acme, member, "record.archive", { ref: "PRJ-0001" });
  assert.throws(() => run(acme, member, "record.create", { kind: "issue_note", body: { title: "T2", project_id: "PRJ-0001" } }), /archived/);
  assert.equal(rec(acme, member, "record.patch", { ref: "ISN-0001", set: { title: "T renamed" } }).rev, 2);
});

test("links: reference fields and cited keys, both directions", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "project", body: { title: "Launch" } });
  rec(acme, member, "record.create", { kind: "knowledge", body: { title: "Label facts", body: "Magnesium 200 mg" } });
  rec(acme, member, "record.create", {
    kind: "entry",
    body: { title: "Label verified", project_id: "PRJ-0001", detail: "Checked against KNW-0001 and KNW-0404." },
  });
  const out = (run(acme, member, "record.links", { ref: "JNL-0001" }) as { out: Link[] }).out;
  assert.deepEqual(
    out.map((l) => [l.key, l.label]),
    [
      ["KNW-0001", "cites"],
      ["PRJ-0001", "project"],
    ],
  );
  const back = (run(acme, member, "record.links", { ref: "PRJ-0001" }) as { in: Link[] }).in;
  assert.deepEqual(
    back.map((l) => [l.key, l.label, l.title]),
    [["JNL-0001", "project", "Label verified"]],
  );
  // Links follow the body: remove the reference and the link goes.
  rec(acme, member, "record.patch", { ref: "JNL-0001", set: { project_id: null } });
  assert.equal((run(acme, member, "record.links", { ref: "PRJ-0001" }) as { in: Link[] }).in.length, 0);
});

test("search finds words anywhere in a record and skips archived records", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", {
    kind: "knowledge",
    body: { title: "UT Support formula", body: "D-Mannose 2000 mg, cranberry extract" },
  });
  rec(acme, member, "record.create", { kind: "entry", body: { title: "Supplier call", notes: ["cranberry price went up"] } });
  const hits = run(acme, member, "record.search", { q: "cranberr" }) as Hit[];
  assert.deepEqual(hits.map((h) => h.key).sort(), ["JNL-0001", "KNW-0001"]);
  assert.deepEqual(
    (run(acme, member, "record.search", { q: "cranberry mannose" }) as Hit[]).map((h) => h.key),
    ["KNW-0001"],
  );
  assert.deepEqual(
    (run(acme, member, "record.search", { q: "cranberry", kind: "entry" }) as Hit[]).map((h) => h.key),
    ["JNL-0001"],
  );
  assert.deepEqual(run(acme, member, "record.search", { q: '"(*) OR NEAR' }), [], "search syntax in the query is plain words");
  rec(acme, member, "record.archive", { ref: "JNL-0001" });
  assert.deepEqual(
    (run(acme, member, "record.search", { q: "cranberry" }) as Hit[]).map((h) => h.key),
    ["KNW-0001"],
  );
});

test("the change feed has one entry per revision, in order", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "entry", body: { title: "A" } });
  rec(acme, member, "record.create", { kind: "entry", body: { title: "B" } });
  rec(acme, member, "record.archive", { ref: "JNL-0001" });
  const all = run(acme, member, "changes.since", { since: 0 }) as Revision[];
  assert.deepEqual(
    all.map((c) => [c.seq, c.key, c.op]),
    [
      [1, "JNL-0001", "create"],
      [2, "JNL-0002", "create"],
      [3, "JNL-0001", "archive"],
    ],
  );
  assert.equal((run(acme, member, "changes.since", { since: 2 }) as Revision[]).length, 1);
});
