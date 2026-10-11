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

test("undo puts a record back and keeps the history", (t) => {
  const { acme } = setup(t);
  rec(acme, member, "record.create", { kind: "issue_note", body: { title: "T", status: "open" } });
  rec(acme, curator, "curator.flag", { title: "unclear", detail: "Review clarity", evidence: ["ISN-0001"] });
  rec(acme, member, "record.create", { kind: "project", body: { title: "P" } });
  rec(acme, member, "record.patch", { ref: "ISN-0001", set: { project_id: "PRJ-0001" } });
  rec(acme, member, "record.patch", { ref: "ISN-0001", set: { status: "resolved" } });
  assert.throws(() => run(acme, admin, "record.undo", { ref: "ISN-0001", rev: 2 }), /changed again/);
  assert.equal(rec(acme, admin, "record.undo", { ref: "ISN-0001", rev: 3 }).body.status, "open");
  const undone = rec(acme, admin, "record.undo", { ref: "ISN-0001" });
  assert.equal(undone.body.status, "resolved", "undoing an undo puts the change back");
  rec(acme, admin, "record.archive", { ref: "ISN-0001" });
  assert.equal(rec(acme, admin, "record.undo", { ref: "ISN-0001" }).archived, false);
  assert.equal((run(acme, admin, "record.history", { ref: "ISN-0001" }) as Revision[]).length, 7);
});
