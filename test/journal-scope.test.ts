import assert from "node:assert/strict";
import { test } from "node:test";
import { JOURNAL_SCOPE_MAX_RECORDS, projectScope, type Rec, uuidv7 } from "../src/core/records.ts";
import { run } from "../src/operations/index.ts";
import { member, rec, setup } from "./helpers.ts";

test("historical Journal scope detects cycles, ancestor contradictions and depth limits with bounded reads", (t) => {
  const { acme } = setup(t);
  const a = rec(acme, member, "record.create", { kind: "project", body: { title: "A" } });
  const b = rec(acme, member, "record.create", { kind: "project", body: { title: "B" } });
  let key = 900;
  const legacy = (id: string, body: Rec["body"]) => {
    const text = JSON.stringify({ title: `Historical ${key}`, type: "note", ...body });
    acme.run("insert into records values (?,?,'entry',1,?,0,'2026-09-01','2026-09-01','legacy-author')", id, `JNL-${key++}`, text);
    acme.run("insert into revisions(record_id,rev,body,archived,changed,op,actor,actor_kind,at) values (?,1,?,0,'[]','import','legacy-author','person','2026-09-01')", id, text);
    return run(acme, member, "record.get", { ref: id }) as Rec;
  };
  const cycleId = uuidv7(), otherId = uuidv7();
  const cycle = legacy(cycleId, { project_id: a.id, about_id: otherId });
  legacy(otherId, { project_id: a.id, about_id: cycleId });
  const conflict = legacy(uuidv7(), { project_id: b.id, about_id: a.id });
  const throughConflict = legacy(uuidv7(), { about_id: conflict.id });
  const missing = legacy(uuidv7(), { project_id: a.id, about_id: "JNL-9999" });
  const unknownProject = legacy(uuidv7(), { project_id: "PRJ-9999", about_id: a.id });
  let deep = legacy(uuidv7(), { about_id: a.id });
  let withinBound = deep;
  for (let i = 1; i < JOURNAL_SCOPE_MAX_RECORDS; i++) {
    deep = legacy(uuidv7(), { about_id: deep.id });
    if (i === JOURNAL_SCOPE_MAX_RECORDS - 2) withinBound = deep;
  }
  assert.equal(projectScope(acme, withinBound).project_id, a.id, "exactly 64 records including the project resolve");
  const read = t.mock.method(acme, "one");
  for (const [entry, message] of [
    [cycle, /Cycle/], [throughConflict, /Conflicting/], [missing, /Unknown historical about/],
    [unknownProject, /Unknown historical project/], [deep, /exceeds 64/],
  ] as const) {
    read.mock.resetCalls();
    const scope = projectScope(acme, entry);
    assert.equal(scope.project_id, null);
    assert.match(scope.problem!, message);
    assert.ok(read.mock.callCount() <= JOURNAL_SCOPE_MAX_RECORDS + 1, "bounded database reads, with repeated project lookups cached");
    assert.throws(() => rec(acme, member, "record.create", { kind: "entry", body: { title: "Cannot inherit invalid scope", about_id: entry.id, project_id: a.id } }), /Cannot resolve Journal project scope/);
    assert.equal((run(acme, member, "record.get", { ref: entry.key }) as Rec).id, entry.id, "historical row still readable");
    assert.ok((run(acme, member, "journal.list", { limit: 500 }) as { key: string }[]).some(e => e.key === entry.key), "company Log preserves historical readback");
  }
  for (const project of [a, b]) {
    const context = run(acme, member, "project.context", { ref: project.id }) as { log: { record: Rec }[]; scope_conflicts: { record: Rec }[] };
    assert.ok(context.scope_conflicts.some(e => e.record.id === throughConflict.id));
    assert.ok(!context.log.some(e => e.record.id === throughConflict.id));
  }
});
