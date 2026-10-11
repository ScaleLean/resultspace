import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, member, rec, setup, viewer } from "./helpers.ts";
import { operations, run } from "../src/operations/index.ts";
import { create, patch } from "../src/core/records.ts";
import type { Rec, Revision } from "../src/core/records.ts";
import type { ProjectContext } from "../src/core/context.ts";
import type { Finding } from "../src/curator/scan.ts";
import { Curator, CURATOR } from "../src/curator/curator.ts";

const fact = (
  project_id: string,
  source_ids: string[],
  value: number,
  scope = "current",
) => ({
  title: `Lead time ${value}`,
  subject: "Supplier A",
  predicate: "lead_time",
  scope,
  unit: "weeks",
  value_type: "number",
  value,
  project_id,
  source_ids,
  observed_at: "2026-10-11",
});
test("focused context, typed facts and contradiction evidence preserve both claims and sourced history", (t) => {
  const { acme, other } = setup(t);
  const project = rec(acme, member, "record.create", {
    kind: "project",
    body: {
      title: "Launch",
      goal: "Prepare sourced packaging",
      objectives: ["Confirm supply"],
      current_state: "Researching",
    },
  });
  const a = rec(acme, member, "record.create", {
    kind: "source",
    body: {
      title: "Supplier quote A",
      url: "https://supplier.example/quote-a",
    },
  });
  const b = rec(acme, member, "record.create", {
    kind: "source",
    body: { title: "Supplier quote B", detail: "Email dated 2026-10-11" },
  });
  const f1 = rec(acme, member, "record.create", {
    kind: "fact",
    body: fact(project.id, [a.key], 4),
  });
  const f2 = rec(acme, member, "record.create", {
    kind: "fact",
    body: fact(project.id, [b.id], 6),
  });
  rec(acme, member, "record.create", {
    kind: "fact",
    body: fact(project.id, [a.id], 8, "next-year"),
  });
  const method = rec(acme, member, "record.create", {
    kind: "knowledge",
    body: {
      title: "Method: compare supplier quotes",
      body: "Compare scope and observation dates before choosing a lead time.",
      project_id: project.key,
      source_ids: [a.id, b.id],
    },
  });
  rec(acme, member, "record.create", {
    kind: "knowledge",
    body: {
      title: "Unrelated confidential detail",
      body: "Should not enter launch context",
      source: "Private research",
    },
  });
  const e1 = rec(acme, member, "journal.log", {
    title: "Quote received",
    project: project.key,
    source: "Supplier email",
  });
  const e2 = rec(acme, member, "journal.log", {
    title: "Method learned",
    project: project.key,
    type: "learning",
    source_ids: [a.key],
    detail: "Confirm the scope first",
  });
  const issues = rec(acme, member, "record.create", {
    kind: "issue",
    body: {
      title: "Clarify conflicting quotes",
      project_id: project.id,
      status: "open",
    },
  });
  const before = [f1, f2].map((r) =>
    rec(acme, admin, "record.get", { ref: r.id }),
  );
  const findings = run(acme, viewer, "curator.scan", {}) as Finding[];
  const clashes = findings.filter((f) => f.type === "contradiction");
  assert.equal(clashes.length, 1);
  assert.deepEqual(
    clashes[0]!.evidence.map((e) => [
      e.record.body.value,
      e.provenance.actor,
      e.sources[0]?.key,
    ]),
    [
      [4, member.name, a.key],
      [6, member.name, b.key],
    ],
  );
  const review = run(acme, CURATOR, "curator.review", {}) as { created: Rec[] };
  assert.equal(review.created.length, 1);
  assert.deepEqual(
    (run(acme, CURATOR, "curator.review", {}) as { created: Rec[] }).created,
    [],
    "same evidence is flagged once",
  );
  assert.deepEqual(
    [f1, f2].map((r) => rec(acme, admin, "record.get", { ref: r.id })),
    before,
    "review never rewrites claims",
  );
  const context = run(acme, viewer, "project.context", {
    ref: project.key,
  }) as ProjectContext;
  assert.equal(context.project.record.body.goal, "Prepare sourced packaging");
  assert.equal(context.facts.length, 3);
  assert.deepEqual(
    context.knowledge.map((e) => e.record.id),
    [method.id],
  );
  assert.deepEqual(
    context.issues.map((e) => e.record.id),
    [issues.id],
  );
  assert.deepEqual(
    context.log.map((e) => e.record.id),
    [e1.id, e2.id],
  );
  assert.equal(context.findings[0]!.record.key, review.created[0]!.key);
  const focused = run(acme, viewer, "project.context", {
    ref: project.key,
    limit: 1,
  }) as ProjectContext;
  assert.equal(focused.truncated, true);
  assert.deepEqual(
    focused.log.map((e) => e.record.id),
    [e2.id],
  );
  assert.equal(focused.findings[0]!.record.key, review.created[0]!.key);
  const flag = review.created[0]!;
  rec(acme, member, "record.patch", {
    ref: f2.key,
    set: { value: 4 },
    why: "Corrected against both quotes",
  });
  assert.deepEqual(
    (
      rec(acme, viewer, "record.get", { ref: flag.key }).body
        .evidence as Finding["evidence"]
    ).map((e) => e.record.body.value),
    [4, 6],
    "evidence remains the reviewed snapshot",
  );
  assert.equal(
    (run(acme, viewer, "record.history", { ref: f2.id }) as Revision[]).at(-1)!
      .why,
    "Corrected against both quotes",
  );
  assert.equal(
    (run(acme, viewer, "curator.scan", {}) as Finding[]).filter(
      (f) => f.type === "contradiction",
    ).length,
    0,
  );
  assert.throws(
    () => run(other, viewer, "project.context", { ref: project.id }),
    /no record/,
  );
  assert.throws(
    () =>
      rec(acme, member, "record.create", {
        kind: "knowledge",
        body: { title: "Bad refs", source_ids: ["SRC-9999"] },
      }),
    /no record/,
  );
  assert.throws(
    () =>
      rec(acme, member, "record.create", {
        kind: "knowledge",
        body: { title: "Bad refs", source_ids: 1 },
      }),
    /reference array/,
  );
  for (const body of [
    { ...fact(project.id, [], 4), value: "four" },
    { ...fact(project.id, [], 4), value_type: "object" },
    { ...fact(project.id, [], 4), subject: "" },
  ])
    assert.throws(
      () => rec(acme, member, "record.create", { kind: "fact", body }),
      /fact/,
    );
});

test("Curator is limited to sourced flags and suggestions; writes never acquire runtime authority", (t) => {
  const { acme } = setup(t);
  const p = rec(acme, member, "record.create", {
    kind: "project",
    body: { title: "Project", current_state: "Research" },
  });
  for (const name of [
    "assignment.next",
    "work.next",
    "permission.check",
    "permission.allow",
    "action.record",
    "agent.presence",
    "request.propose",
    "request.decide",
    "skill.list",
    "skill.show",
  ])
    assert.throws(() => run(acme, admin, name, {}), /no operation/);
  assert.ok(
    !operations.some((o) =>
      /^(assignment|work|permission|action|request|skill)\./.test(o.name),
    ),
  );
  assert.throws(
    () =>
      run(acme, CURATOR, "record.patch", {
        ref: p.key,
        set: { current_state: "Complete" },
      }),
    /Curator/,
  );
  assert.throws(
    () => run(acme, CURATOR, "journal.log", { title: "Outcome invented" }),
    /Curator/,
  );
  assert.throws(
    () =>
      create(acme, CURATOR, "knowledge", { title: "Silently invent claim" }),
    /Curator/,
  );
  assert.throws(
    () => patch(acme, CURATOR, p.id, { current_state: "Complete" }),
    /Curator/,
  );
  const flag = rec(acme, CURATOR, "curator.flag", {
    title: "Current state needs evidence",
    detail: "The state is unsupported",
    evidence: [p.key],
    suggestion: "Record the source when known",
  });
  const h = run(acme, viewer, "record.history", {
    ref: flag.key,
  }) as Revision[];
  assert.deepEqual([h[0]!.actor, h[0]!.actor_kind], ["curator", "curator"]);
  for (const kind of [
    "assignment",
    "work_order",
    "task",
    "skill",
    "request",
    "goal",
  ])
    assert.throws(
      () =>
        rec(acme, admin, "record.create", {
          kind,
          body: { title: "Retired", owner: "hermes" },
        }),
      /unknown kind|retired/,
    );
  assert.throws(
    () =>
      rec(acme, member, "record.create", {
        kind: "issue",
        body: { title: "Unassigned", owner: "hermes" },
      }),
    /retired/,
  );
  const provenance = rec(acme, member, "record.create", {
    kind: "knowledge",
    body: {
      title: "Claim",
      actor: "alex",
      updated_by: "alex",
      source: "Author cites source",
    },
  });
  assert.equal(provenance.updated_by, member.name);
  assert.equal(
    (
      run(acme, admin, "record.history", { ref: provenance.id }) as Revision[]
    )[0]!.actor,
    member.name,
  );
});

test("regular evidence Curator detects unsupported and stale claims without a model", async (t) => {
  const { dir, acme, companies } = setup(t);
  const claim = rec(acme, member, "record.create", {
    kind: "fact",
    body: {
      title: "Old price",
      subject: "Product",
      predicate: "price",
      value_type: "number",
      value: 12,
      unit: "USD",
      observed_at: "2025-01-01",
    },
  });
  const curator = new Curator(companies, { dataDir: dir });
  curator.available = false;
  t.after(() => curator.close());
  const reports = await curator.tick();
  assert.equal(reports[0]?.duty, "evidence");
  const flags = run(acme, viewer, "record.list", { kind: "flag" }) as Rec[];
  assert.deepEqual(flags.map((r) => r.body.flag_type).sort(), [
    "stale",
    "unsupported",
  ]);
  assert.equal(rec(acme, viewer, "record.get", { ref: claim.id }).rev, 1);
  assert.deepEqual(await curator.tick(), []);
});

test("company attachments remain immutable, retrievable, and isolated", (t) => {
  const { acme, other } = setup(t);
  const bytes = Buffer.from("Sourced supplier document");
  const blob = run(acme, member, "blob.put", {
    b64: bytes.toString("base64"),
  }) as { sha256: string };
  const read = run(acme, viewer, "blob.get", { sha256: blob.sha256 }) as {
    b64: string;
  };
  assert.deepEqual(Buffer.from(read.b64, "base64"), bytes);
  assert.throws(
    () => run(other, viewer, "blob.get", { sha256: blob.sha256 }),
    /no attachment/,
  );
  const source = rec(acme, member, "record.create", {
    kind: "artifact",
    body: { title: "Quote attachment", sha256: blob.sha256 },
  });
  assert.equal(
    rec(acme, viewer, "record.get", { ref: source.key }).body.sha256,
    blob.sha256,
  );
  assert.throws(() => acme.run("delete from blobs"), /never deleted/);
});
