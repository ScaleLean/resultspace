import assert from "node:assert/strict";
import { test } from "node:test";
import type { Actor } from "../src/core/agents.ts";
import { addAgent } from "../src/core/agents.ts";
import { RsError } from "../src/core/errors.ts";
import type { Revision } from "../src/core/records.ts";
import { run } from "../src/operations/index.ts";
import { admin, member, rec, setup } from "./helpers.ts";

const curator: Actor = { kind: "curator", name: "curator", role: "member" };
const code = (c: string) => (e: unknown) => e instanceof RsError && e.code === c;

test("the Curator curates: it links and flags on its own, proposes changes of meaning, and does no company work", (t) => {
  const { acme } = setup(t);
  addAgent(acme, "hermes:acme");
  rec(acme, member, "record.create", { kind: "project", body: { title: "Launch", status: "active" } });
  rec(acme, member, "record.create", { kind: "task", body: { title: "Call supplier", status: "todo" } });
  rec(acme, member, "record.create", { kind: "task", body: { title: "Call the supplier", status: "todo", project_id: "PRJ-0001" } });

  // On its own: fill an empty reference, flag, hand work to an agent.
  assert.equal(rec(acme, curator, "record.patch", { ref: "TSK-0001", set: { project_id: "PRJ-0001" }, why: "same work as TSK-0002" }).rev, 2);
  rec(acme, curator, "record.create", { kind: "flag", body: { title: "TSK-0001 and TSK-0002 are the same task", flag_type: "duplicate", about_id: "TSK-0001", other_id: "TSK-0002", status: "open" } });
  rec(acme, curator, "record.create", { kind: "assignment", body: { title: "Confirm lead time", owner: "hermes:acme", brief: "Ask the supplier" } });
  rec(acme, curator, "record.create", { kind: "work_order", body: { title: "Old name still allowed", owner: "hermes:acme" } });

  // Not on its own: change meaning, overwrite a reference, archive, log results, record actions, do work.
  for (const [name, input] of [
    ["record.patch", { ref: "TSK-0001", set: { status: "done" } }],
    ["record.patch", { ref: "TSK-0001", set: { title: "Something else" } }],
    ["record.patch", { ref: "TSK-0002", set: { project_id: null } }],
    ["record.archive", { ref: "TSK-0002" }],
    ["record.create", { kind: "task", body: { title: "New task" } }],
    ["record.create", { kind: "knowledge", body: { title: "A fact" } }],
    ["record.create", { kind: "flag", body: { title: "x" }, result: "I did a thing" }],
    ["journal.log", { title: "Curator did company work" }],
    ["action.record", { action: "publish", detail: "posted" }],
    ["work.next", {}],
    ["work.report", { ref: "ASG-0001", result: "done" }],
    ["assignment.next", {}],
    ["assignment.report", { ref: "ASG-0001", result: "done" }],
    ["assignment.verify", { ref: "ASG-0001", verdict: "verified" }],
    ["kind.define", { kind: "x", prefix: "XX" }],
  ] as const) assert.throws(() => run(acme, curator, name, input), code("forbidden"), name);

  // The way to change meaning: a request a person approves. Approving runs the change as that person.
  const req = rec(acme, curator, "request.propose", { title: "Archive TSK-0001 as a duplicate of TSK-0002?", operation: "record.archive", input: { ref: "TSK-0001" }, why: "Same title, same project" });
  assert.equal(req.key, "REQ-0001");
  assert.throws(() => run(acme, curator, "request.propose", { title: "x", operation: "record.patch", input: { nope: 1 }, why: "y" }), /does not fit/);
  assert.throws(() => run(acme, curator, "request.decide", { ref: "REQ-0001", approve: true }), code("forbidden"));
  assert.throws(() => run(acme, member, "request.decide", { ref: "REQ-0001", approve: true }), code("forbidden"));
  const inbox = run(acme, admin, "inbox.get", {}) as { requests: { key: string; about: { key: string } | null }[]; flags: { key: string; type: string }[] };
  assert.deepEqual(inbox.requests.map((r) => [r.key, r.about?.key]), [["REQ-0001", "TSK-0001"]]);
  assert.deepEqual(inbox.flags.map((f) => [f.key, f.type]), [["FLG-0001", "duplicate"]]);
  const decided = rec(acme, admin, "request.decide", { ref: "REQ-0001", approve: true });
  assert.equal(decided.body.status, "approved");
  assert.equal(rec(acme, admin, "record.get", { ref: "TSK-0001" }).archived, true);
  const last = (run(acme, admin, "record.history", { ref: "TSK-0001" }) as Revision[]).at(-1)!;
  assert.equal(last.actor, "alex");
  assert.match(last.why ?? "", /approved REQ-0001 \(proposed by curator\)/);
  assert.throws(() => run(acme, admin, "request.decide", { ref: "REQ-0001", approve: false }), /already approved/);
});

test("undo puts a record back and keeps the history", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "task", body: { title: "T", status: "todo" } });
  rec(acme, curator, "record.create", { kind: "flag", body: { title: "unclear", about_id: "TSK-0001", status: "open" } });
  rec(acme, member, "record.create", { kind: "project", body: { title: "P" } });
  rec(acme, curator, "record.patch", { ref: "TSK-0001", set: { project_id: "PRJ-0001" } });
  rec(acme, member, "record.patch", { ref: "TSK-0001", set: { status: "blocked" } });
  assert.throws(() => run(acme, admin, "record.undo", { ref: "TSK-0001", rev: 2 }), /changed again/);
  assert.equal(rec(acme, admin, "record.undo", { ref: "TSK-0001", rev: 3 }).body.status, "todo");
  const undone = rec(acme, admin, "record.undo", { ref: "TSK-0001" });
  assert.equal(undone.body.status, "blocked", "undoing an undo puts the change back");
  rec(acme, admin, "record.archive", { ref: "TSK-0001" });
  assert.equal(rec(acme, admin, "record.undo", { ref: "TSK-0001" }).archived, false);
  assert.equal((run(acme, admin, "record.history", { ref: "TSK-0001" }) as Revision[]).length, 7);
});
