// Schemas 2/3/4 upgrade directly to 6; original work/assignment records remain read-only with their exact keys.
import assert from "node:assert/strict";
import {
  readFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Actor } from "../src/core/agents.ts";
import { addAgent } from "../src/core/agents.ts";
import { Companies } from "../src/core/companies.ts";
import { Company, companyFile } from "../src/core/company.ts";
import { NodeDb } from "../src/core/db.ts";
import { RsError } from "../src/core/errors.ts";
import type { Rec, Revision } from "../src/core/records.ts";
import { UPGRADES } from "../src/core/schema.ts";
import { run } from "../src/operations/index.ts";
import type { JournalItem } from "../src/operations/views.ts";
import { member, setup } from "./helpers.ts";

const admin: Actor = { kind: "person", name: "alex", role: "admin" };
const agent: Actor = { kind: "agent", name: "hermes:acme", role: "member" };
const stranger: Actor = { kind: "agent", name: "hermes:else", role: "member" };
const code = (c: string) => (e: unknown) =>
  e instanceof RsError && e.code === c;

// Original built-in kinds, with schema 2 work orders under their old name.
import { priorKinds } from "./fixtures/kinds.ts";
const V2_KINDS = priorKinds.map((k) =>
  k.kind === "assignment"
    ? { ...k, kind: "work_order", prefix: "WO" }
    : k.kind === "entry"
      ? {
          ...k,
          refs: {
            about_id: null,
            project_id: "project",
            work_order_id: "work_order",
          },
        }
      : k,
);

const ID = {
  project: "0190a000-0000-7000-8000-000000000001",
  imported: "0190a000-0000-7000-8000-000000000002",
  done: "0190a000-0000-7000-8000-000000000003",
  open: "0190a000-0000-7000-8000-000000000004",
  outcome: "0190a000-0000-7000-8000-000000000005",
  action: "0190a000-0000-7000-8000-000000000006",
  session: "0190a000-0000-7000-8000-000000000007",
  note: "0190a000-0000-7000-8000-000000000008",
};
type Body = Record<string, unknown>;
type Version = {
  body: Body;
  at: string;
  by: string;
  op?: string;
  why?: string;
};

/** A schema-2 company file: an open work order, a finished one, an imported one, and linked outcome/action/session entries. */
function schema2File(
  dir: string,
  slug: string,
  extraKinds: { kind: string; prefix: string }[] = [],
) {
  const db = new NodeDb(companyFile(dir, slug));
  db.exec(
    readFileSync(new URL("./fixtures/schema4.sql", import.meta.url), "utf8"),
  );
  db.exec("drop table evidence_authority");
  for (const [k, v] of [
    ["slug", slug],
    ["name", "Acme"],
    ["schema_version", "2"],
    ["created_at", "2026-09-01T00:00:00.000Z"],
  ])
    db.run("insert into meta (k, v) values (?, ?)", k!, v!);
  for (const k of [
    ...V2_KINDS,
    ...extraKinds.map((x) => ({
      ...x,
      title_field: "title",
      statuses: null,
      refs: {},
    })),
  ])
    db.run(
      "insert into kinds (kind, prefix, title_field, statuses, refs) values (?, ?, ?, ?, ?)",
      k.kind,
      k.prefix,
      k.title_field,
      k.statuses ? JSON.stringify(k.statuses) : null,
      JSON.stringify(k.refs),
    );
  db.run(
    "insert into agents (name, role, active, created_at) values ('hermes:acme', 'member', 1, '2026-09-01T00:00:00.000Z')",
  );
  db.run(
    "insert into agents (name, role, active, created_at) values ('hermes:else', 'member', 1, '2026-09-01T00:00:00.000Z')",
  );
  const put = (id: string, key: string, kind: string, versions: Version[]) => {
    const last = versions.at(-1)!;
    db.run(
      "insert into records (id, key, kind, rev, body, archived, created_at, updated_at, updated_by) values (?, ?, ?, ?, ?, 0, ?, ?, ?)",
      id,
      key,
      kind,
      versions.length,
      JSON.stringify(last.body),
      versions[0]!.at,
      last.at,
      last.by,
    );
    let prev: Body = {};
    versions.forEach((v, i) => {
      const changed = [
        ...new Set([...Object.keys(prev), ...Object.keys(v.body)]),
      ]
        .filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(v.body[f]))
        .sort();
      db.run(
        "insert into revisions (record_id, rev, body, archived, changed, op, op_id, actor, actor_kind, at, why) values (?, ?, ?, 0, ?, ?, null, ?, ?, ?, ?)",
        id,
        i + 1,
        JSON.stringify(v.body),
        JSON.stringify(changed),
        v.op ?? (i ? "patch" : "create"),
        v.by,
        v.by === "alex" ? "person" : "agent",
        v.at,
        v.why ?? null,
      );
      prev = v.body;
    });
    db.run(
      "insert into records_fts (id, key, title, body) values (?, ?, ?, ?)",
      id,
      key,
      String(last.body.title ?? key),
      Object.values(last.body)
        .filter((x) => typeof x === "string")
        .join("\n"),
    );
  };
  const link = (from: string, to: string, label: string) =>
    db.run(
      "insert into links (from_id, to_id, label) values (?, ?, ?)",
      from,
      to,
      label,
    );

  put(ID.project, "PRJ-0001", "project", [
    {
      body: { title: "Launch", status: "active" },
      at: "2026-09-01T10:00:00.000Z",
      by: "alex",
    },
  ]);
  // Imported from the old system with a three-digit key, finished long ago.
  put(ID.imported, "WO-001", "work_order", [
    {
      body: {
        title: "Old audit",
        owner: "curator",
        status: "done",
        result: "Audit filed",
      },
      at: "2026-08-01T10:00:00.000Z",
      by: "import",
      op: "import",
    },
  ]);
  const done = {
    title: "Check label",
    owner: "hermes:acme",
    brief: "Compare with the formula",
    project_id: ID.project,
  };
  put(ID.done, "WO-0001", "work_order", [
    {
      body: { ...done, status: "queued" },
      at: "2026-09-02T10:00:00.000Z",
      by: "alex",
    },
    {
      body: { ...done, status: "picked_up" },
      at: "2026-09-02T11:00:00.000Z",
      by: "hermes:acme",
    },
    {
      body: { ...done, status: "in_progress" },
      at: "2026-09-02T11:05:00.000Z",
      by: "hermes:acme",
    },
    {
      body: { ...done, status: "done", result: "Label matches the formula" },
      at: "2026-09-02T12:00:00.000Z",
      by: "hermes:acme",
    },
  ]);
  const open = {
    title: "Pause dead campaigns",
    owner: "hermes:acme",
    brief: "Pause campaigns with spend and no sales",
    due_on: "2026-12-01",
  };
  put(ID.open, "WO-0002", "work_order", [
    {
      body: { ...open, status: "queued" },
      at: "2026-09-03T10:00:00.000Z",
      by: "alex",
    },
    {
      body: { ...open, status: "picked_up" },
      at: "2026-09-03T11:00:00.000Z",
      by: "hermes:acme",
    },
    {
      body: { ...open, status: "in_progress", progress: "Listed 3 campaigns" },
      at: "2026-09-03T11:30:00.000Z",
      by: "hermes:acme",
    },
  ]);
  put(ID.outcome, "JNL-0001", "entry", [
    {
      body: {
        type: "outcome",
        title: "Label matches the formula",
        about_id: ID.done,
        project_id: ID.project,
        work_order_id: ID.done,
      },
      at: "2026-09-02T12:00:00.000Z",
      by: "hermes:acme",
    },
  ]);
  put(ID.action, "JNL-0002", "entry", [
    {
      body: {
        type: "action",
        title: "Paused campaign 12",
        action: "ads",
        about_id: ID.open,
        work_order_id: ID.open,
      },
      at: "2026-09-03T11:40:00.000Z",
      by: "hermes:acme",
    },
  ]);
  put(ID.session, "JNL-0003", "entry", [
    {
      body: {
        type: "session",
        title: "3 steps: ads API ok",
        session: "s1",
        about_id: ID.open,
        work_order_id: ID.open,
      },
      at: "2026-09-03T11:45:00.000Z",
      by: "hermes:acme",
    },
  ]);
  put(ID.note, "JNL-0004", "entry", [
    {
      body: { type: "note", title: "See WO-0001 for the label check" },
      at: "2026-09-04T09:00:00.000Z",
      by: "alex",
    },
  ]);
  link(ID.done, ID.project, "project");
  for (const [from, to] of [
    [ID.outcome, ID.done],
    [ID.action, ID.open],
    [ID.session, ID.open],
  ] as const) {
    link(from, to, "about");
    link(from, to, "work_order");
  }
  link(ID.outcome, ID.project, "project");
  link(ID.note, ID.done, "cites");
  for (const [p, n] of [
    ["PRJ", 2],
    ["WO", 3],
    ["JNL", 5],
  ] as const)
    db.run("insert into key_counters (prefix, next_n) values (?, ?)", p, n);
  db.run(
    "insert into ops (op_id, actor, request_hash, outcome, at) values ('op-claim-0001', 'hermes:acme', 'h', ?, '2026-09-03T11:00:00.000Z')",
    JSON.stringify({
      work_order: { key: "WO-0002", status: "picked_up" },
      claimed: true,
    }),
  );
  db.close();
}

const dump = (dir: string) => {
  const db = new NodeDb(companyFile(dir, "acme"), { readOnly: true });
  try {
    return Object.fromEntries(
      [
        "records",
        "revisions",
        "ops",
        "key_counters",
        "links",
        "blobs",
        "agents",
        "agent_keys",
        "records_fts",
      ].map((table) => [table, db.all(`select * from ${table} order by 1`)]),
    );
  } finally {
    db.close();
  }
};
for (const version of [2, 3, 4])
  test(`schema ${version} -> 6 preserves all content and supports backup/restore and rollback`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "rs-migrate5-"));
    const source = join(dir, "source");
    mkdirSync(source);
    schema2File(source, "acme");
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const db = new NodeDb(companyFile(source, "acme"));
    if (version >= 3) {
      db.run(
        "insert into kinds values ('assignment','ASG','title',null,'{\"project_id\":\"project\"}')",
      );
      db.run("update records set kind='assignment' where kind='work_order'");
      db.run("delete from kinds where kind='work_order'");
      db.run(
        'update kinds set refs = \'{"about_id":null,"project_id":"project","assignment_id":"assignment"}\' where kind=\'entry\'',
      );
      db.run(
        "update records set body=json_set(json_remove(body,'$.work_order_id'),'$.assignment_id',json_extract(body,'$.work_order_id')) where json_type(body,'$.work_order_id') is not null",
      );
      db.run("update links set label='assignment' where label='work_order'");
    }
    if (version === 4)
      db.exec(
        "create table evidence_authority(record_id text primary key references records(id),assignment_ids text not null) strict;",
      );
    if (version === 4)
      db.run(
        "insert into evidence_authority values (?,?)",
        ID.outcome,
        JSON.stringify([ID.done]),
      );
    db.run(
      "insert into presence values ('hermes:acme','session-1','2026-10-01')",
    );
    db.run(
      "insert into blobs values ('abc',3,?,'2026-10-01')",
      Buffer.from("abc"),
    );
    db.run("update meta set v=? where k='schema_version'", String(version));
    db.exec("pragma wal_checkpoint(truncate)");
    db.close();
    const credential = "rsk_acme_" + "a".repeat(32);
    const { createHash } = await import("node:crypto");
    const credentialsDb = new NodeDb(companyFile(source, "acme"));
    credentialsDb.run(
      "insert into agent_keys values (?,'hermes:acme','2026-10-01',null)",
      createHash("sha256").update(credential).digest("hex"),
    );
    for (const [kind, key] of [
      ["task", "TSK-0001"],
      ["skill", "SKL-0001"],
      ["request", "REQ-0001"],
      ["goal", "GOAL-0001"],
      ["custom_claim", "CLM-0001"],
    ]) {
      if (kind === "custom_claim")
        credentialsDb.run(
          "insert into kinds values ('custom_claim','CLM','title',null,'{}')",
        );
      const id =
        "0190a000-0000-7000-8000-" +
        String(
          100 +
            ["task", "skill", "request", "goal", "custom_claim"].indexOf(kind!),
        ).padStart(12, "0");
      const body = JSON.stringify({
        title: "Historical " + kind,
        meaning: "Preserve original claim and lifecycle",
        status: "draft",
      });
      credentialsDb.run(
        "insert into records values (?,?,?,1,?,0,'2026-10-01','2026-10-01','alex')",
        id,
        key!,
        kind!,
        body,
      );
      credentialsDb.run(
        "insert into revisions(record_id,rev,body,archived,changed,op,actor,actor_kind,at) values (?,1,?,0,'[\"title\"]','create','alex','person','2026-10-01')",
        id,
        body,
      );
    }
    credentialsDb.close();
    const before = dump(source);
    const { backupDirectory, restoreDirectory } = await import(
      "../src/core/backup.ts"
    );
    const prior = join(dir, "prior");
    await backupDirectory(source, prior, true);
    const companies = new Companies(source);
    const co = companies.get("acme");
    assert.equal(
      co.one<{ v: string }>("select v from meta where k='schema_version'")!.v,
      "6",
    );
    assert.deepEqual(
      dump(source),
      before,
      "all current records, complete revisions, links, credentials, blobs, counters and op outcomes are unchanged",
    );
    const archived = run(co, admin, "archive.list", {}) as Rec[];
    assert.equal(archived.length, 10);
    assert.equal(companies.authenticate(credential)?.actor.name, agent.name);
    assert.equal(
      (run(co, admin, "record.get", { ref: "WO-0001" }) as Rec).body.result,
      "Label matches the formula",
    );
    assert.equal(
      (run(co, admin, "record.history", { ref: "WO-0001" }) as Revision[])
        .length,
      4,
    );
    for (const ref of ["WO-0001", "JNL-0002"])
      for (const [operation, input] of [
        ["record.patch", { ref, set: { title: "x" } }],
        ["record.archive", { ref }],
        ["record.restore", { ref }],
        ["record.undo", { ref }],
      ] as const)
        assert.throws(
          () => run(co, admin, operation, input),
          code("forbidden"),
        );
    assert.throws(
      () => co.run("update records set body='{}' where key='WO-0001'"),
      /read-only/,
    );
    assert.equal(
      co.one<{ agent: string }>("select * from legacy_presence")?.agent,
      "hermes:acme",
    );
    if (version === 4)
      assert.deepEqual(
        JSON.parse(
          co.one<{ assignment_ids: string }>(
            "select * from legacy_evidence_authority",
          )!.assignment_ids,
        ),
        [ID.done],
      );
    const project = run(co, agent, "project.context", { ref: "PRJ-0001" }) as {
      log: { record: Rec }[];
    };
    assert.deepEqual(
      project.log.map((e) => e.record.key),
      ["JNL-0001"],
    );
    assert.throws(
      () =>
        run(companies.create("other", "Other"), agent, "record.get", {
          ref: ID.done,
        }),
      code("not_found"),
    );
    companies.close();
    const afterBackup = join(dir, "after-backup");
    await backupDirectory(source, afterBackup, true);
    const restored = join(dir, "restored");
    restoreDirectory(afterBackup, restored);
    assert.deepEqual(dump(restored), before);
    const again = new Companies(restored);
    assert.equal(
      (run(again.get("acme"), admin, "archive.list", {}) as Rec[]).length,
      10,
    );
    again.close();
    const rollback = join(dir, "rollback");
    restoreDirectory(prior, rollback);
    assert.deepEqual(dump(rollback), before);
    const rollbackDb = new NodeDb(companyFile(rollback, "acme"), {
      readOnly: true,
    });
    assert.equal(
      rollbackDb.one<{ v: string }>(
        "select v from meta where k='schema_version'",
      )!.v,
      String(version),
    );
    rollbackDb.close();
    const { readdirSync } = await import("node:fs");
    assert.ok(
      readdirSync(source).some((f) => f.includes(".pre-schema-6-")),
      "automatic pre-upgrade snapshot",
    );
  });

test("migration collision rolls back every schema change and preserves original file", async (t) => {
  for (const [extra, message] of [
    [{ kind: "assessment", prefix: "FCT" }, /prefix FCT/],
    [{ kind: "fact", prefix: "CUSTOM" }, /kind fact already exists/],
    [{ kind: "issue_note", prefix: "CUSTOM" }, /kind issue_note already exists/],
    [{ kind: "custom_note", prefix: "ISN" }, /prefix ISN/],
  ] as const) {
    const dir = mkdtempSync(join(tmpdir(), "rs-collision-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    schema2File(dir, "acme", [extra]);
    const before = dump(dir);
    const companies = new Companies(dir);
    t.after(() => companies.close());
    assert.throws(() => companies.get("acme"), message);
    assert.deepEqual(dump(dir), before);
    const db = new NodeDb(companyFile(dir, "acme"), { readOnly: true });
    assert.equal(
      db.one<{ v: string }>("select v from meta where k='schema_version'")!.v,
      "2",
    );
    assert.equal(
      db.one("select 1 from sqlite_master where name='legacy_records'"),
      undefined,
    );
    db.close();
  }
});

test("backup captures WAL; restore rejects tampering and refuses existing destinations", async (t) => {
  const { dir, acme } = setup(t);
  const { backupDirectory, restoreDirectory } = await import(
    "../src/core/backup.ts"
  );
  const backup = join(tmpdir(), `rs-backup-${crypto.randomUUID()}`);
  const restored = backup + "-restored";
  t.after(() => {
    rmSync(backup, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  });
  run(acme, admin, "record.create", {
    kind: "knowledge",
    body: { title: "Committed in WAL", body: "preserve me" },
  });
  await assert.rejects(backupDirectory(dir, backup, false), /quiesced/);
  await backupDirectory(dir, backup, true);
  restoreDirectory(backup, restored);
  const co = Company.open(restored, "acme");
  assert.equal(
    (run(co, admin, "record.get", { ref: "KNW-0001" }) as Rec).body.body,
    "preserve me",
  );
  co.close();
  assert.throws(() => restoreDirectory(backup, restored), /must be new/);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(backup, "acme.sqlite"), "corrupt");
  assert.throws(
    () => restoreDirectory(backup, backup + "-bad"),
    /verification failed/,
  );
});

test("directory rehearsal preserves account sessions and Curator databases alongside companies", async (t) => {
  const { dir, acme } = setup(t);
  const { People } = await import("../src/core/people.ts");
  const { backupDirectory, restoreDirectory } = await import(
    "../src/core/backup.ts"
  );
  const people = People.open(dir);
  await people.add("alex", "alex@example.test", {
    password: "disposable-long-passphrase",
  });
  const token = await people.signIn(
    "alex@example.test",
    "disposable-long-passphrase",
    "127.0.0.1",
  );
  assert.ok(token);
  const agentDb = new NodeDb(join(dir, "acme.agent.sqlite"));
  agentDb.exec(
    "create table transcript (text text); insert into transcript values ('Curator evidence conversation');",
  );
  agentDb.close();
  run(acme, member, "journal.log", {
    title: "Sourced learning",
    source: "Review notes",
  });
  const backup = join(tmpdir(), `rs-directory-${crypto.randomUUID()}`);
  const restored = backup + "-restored";
  t.after(() => {
    people.close();
    rmSync(backup, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  });
  const manifest = await backupDirectory(dir, backup, true);
  assert.ok(manifest.files["_system.sqlite"]);
  assert.ok(manifest.files["acme.agent.sqlite"]);
  restoreDirectory(backup, restored);
  const accounts = People.open(restored);
  assert.equal(accounts.session(token)?.name, "alex");
  accounts.close();
  const database = new NodeDb(join(restored, "acme.agent.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    database.one<{ text: string }>("select text from transcript")?.text,
    "Curator evidence conversation",
  );
  database.close();
});

test("schema 4 issue/ISS collision: four synthetic historical records survive archive, isolation and rollback", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rs-issue-collision-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "source"); mkdirSync(source);
  schema2File(source, "acme");
  const db = new NodeDb(companyFile(source, "acme"));
  db.exec(readFileSync(new URL("./fixtures/schema4-issue-collision.sql", import.meta.url), "utf8"));
  db.close();
  const before = dump(source);
  const { backupDirectory, restoreDirectory } = await import("../src/core/backup.ts");
  const prior = join(dir, "prior"); await backupDirectory(source, prior, true);
  const companies = new Companies(source), co = companies.get("acme");
  assert.deepEqual(dump(source), before, "migration leaves records, bodies, revisions, keys, links and counters byte-for-byte unchanged");
  for (let n = 1; n <= 4; n++) {
    const ref = `ISS-${String(n).padStart(4, "0")}`;
    assert.equal((run(co, admin, "record.get", { ref }) as Rec).kind, "issue");
    assert.equal((run(co, admin, "record.history", { ref }) as Revision[]).length, 2);
    assert.throws(() => run(co, admin, "record.patch", { ref, set: { title: "rewrite" } }), code("forbidden"));
  }
  assert.equal((run(co, admin, "archive.list", {}) as Rec[]).filter(r => r.kind === "issue").length, 4);
  const note = run(co, admin, "record.create", { kind: "issue_note", body: { title: "Unassigned question", project_id: ID.project } }) as Rec;
  assert.equal(note.key, "ISN-0001");
  assert.throws(() => run(co, admin, "record.create", { kind: "issue", body: { title: "shadow workflow" } }), code("forbidden"));
  const other = companies.create("other-co", "Other");
  assert.throws(() => run(other, admin, "record.get", { ref: "ISS-0001" }), code("not_found"));
  assert.equal((run(other, admin, "record.create", { kind: "issue_note", body: { title: "Other question" } }) as Rec).key, "ISN-0001");
  companies.close();
  const backup = join(dir, "after"); await backupDirectory(source, backup, true);
  const restored = join(dir, "restored"); restoreDirectory(backup, restored);
  const restoredCompanies = new Companies(restored);
  assert.equal((run(restoredCompanies.get("acme"), admin, "record.history", { ref: "ISS-0004" }) as Revision[]).length, 2);
  assert.equal((run(restoredCompanies.get("acme"), admin, "record.get", { ref: "ISN-0001" }) as Rec).kind, "issue_note"); restoredCompanies.close();
  const rollback = join(dir, "rollback"); restoreDirectory(prior, rollback);
  assert.deepEqual(dump(rollback), before);
  const rolled = new NodeDb(companyFile(rollback, "acme"), { readOnly: true });
  assert.equal(rolled.one<{v:string}>("select v from meta where k='schema_version'")!.v, "4"); rolled.close();
});

test("legacy migration derives assertion history and flags contradictory Journal scope without rewriting it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rs-legacy-provenance-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  schema2File(dir, "acme");
  const db = new NodeDb(companyFile(dir, "acme"));
  const bodies = [
    { title: "Original", body: "Original assertion", project_id: ID.project },
    { title: "Original", body: "Revised assertion", project_id: ID.project },
    { title: "Retitled", body: "Revised assertion", project_id: ID.project, source: "Synthetic citation" },
  ];
  db.run("insert into records values ('legacy-learning','KNW-0001','knowledge',3,?,0,'2026-09-01','2026-09-03','alex')", JSON.stringify(bodies[2]));
  for (const [i, body] of bodies.entries())
    db.run("insert into revisions(record_id,rev,body,archived,changed,op,actor,actor_kind,at) values ('legacy-learning',?,?,0,'[]',?,?,?,?)", i + 1, JSON.stringify(body), i ? "patch" : "import", i === 1 ? "hermes:acme" : "alex", i === 1 ? "agent" : "person", `2026-09-0${i + 1}`);
  db.run("insert into records values ('project-b','PRJ-0002','project',1,'{\"title\":\"Other project\"}',0,'2026-09-01','2026-09-01','alex')");
  db.run("insert into revisions(record_id,rev,body,archived,changed,op,actor,actor_kind,at) values ('project-b',1,'{\"title\":\"Other project\"}',0,'[\"title\"]','create','alex','person','2026-09-01')");
  db.run("update records set body=json_set(body,'$.about_id',?,'$.project_id','project-b') where id=?", ID.project, ID.note);
  db.close();
  const before = dump(dir), companies = new Companies(dir), co = companies.get("acme");
  t.after(() => companies.close());
  assert.deepEqual(dump(dir), before);
  const { projectContext } = await import("../src/core/context.ts");
  const a = projectContext(co, ID.project), b = projectContext(co, "project-b");
  const claim = a.knowledge[0]!;
  assert.equal(claim.provenance.actor, "hermes:acme"); assert.equal(claim.provenance.rev, 2);
  assert.equal(claim.last_edited.actor, "alex"); assert.equal(claim.citation_provenance.rev, 3);
  assert.equal(claim.original.body.body, "Original assertion");
  for (const context of [a, b]) {
    assert.ok(!context.log.some(e => e.record.id === ID.note));
    assert.equal(context.scope_conflicts[0]!.record.id, ID.note);
  }
  assert.equal((run(co, admin, "record.get", { ref: "JNL-0004" }) as Rec).body.project_id, "project-b");
  assert.ok((run(co, admin, "journal.list", {}) as JournalItem[]).some(e => e.key === "JNL-0004"));
  const legacyLinks = (run(co, admin, "record.get", { ref: "JNL-0004" }) as Rec).body;
  const edited = run(co, admin, "record.patch", { ref: "JNL-0004", set: { title: "Legacy content correction" } }) as Rec;
  assert.equal(edited.body.about_id, legacyLinks.about_id); assert.equal(edited.body.project_id, legacyLinks.project_id);
  assert.throws(() => run(co, admin, "record.patch", { ref: "JNL-0004", set: { project_id: ID.project } }), /immutable/);
  assert.equal(projectContext(co, ID.project).scope_conflicts[0]!.record.body.title, "Legacy content correction");

});

test("prior disposable schema 5 upgrades to distinct issue_note identity without changing old notes", (t) => {
  const { dir, companies, acme } = setup(t);
  const old = run(acme, admin, "record.create", { kind: "issue_note", body: { title: "Prior disposable note" } }) as Rec;
  const migratedFact = run(acme, admin, "record.create", { kind: "fact", body: { title: "Original fact", subject: "Supplier", predicate: "lead_time", value_type: "number", value: 4 } }) as Rec;
  run(acme, agent, "record.patch", { ref: migratedFact.id, set: { value: 6 } });
  run(acme, admin, "record.patch", { ref: migratedFact.id, set: { title: "Retitled", source: "Synthetic citation" } });
  companies.close();
  const db = new NodeDb(companyFile(dir, "acme"));
  db.run("insert into kinds select 'issue','ISS',title_field,statuses,refs from kinds where kind='issue_note'");
  db.run("update records set kind='issue',key='ISS-0001' where id=?", old.id);
  db.run("delete from kinds where kind='issue_note'");
  db.run("update records_fts set key='ISS-0001' where id=?", old.id);
  db.run("update key_counters set prefix='ISS' where prefix='ISN'");
  db.run("update meta set v='5' where k='schema_version'"); db.close();
  const before = dump(dir), upgraded = new Companies(dir);
  t.after(() => upgraded.close());
  const co = upgraded.get("acme"); assert.deepEqual(dump(dir), before);
  assert.equal((run(co, admin, "record.get", { ref: "ISS-0001" }) as Rec).id, old.id);
  assert.equal((run(co, admin, "archive.list", {}) as Rec[]).length, 1);
  const context = run(co, admin, "record.context", { ref: migratedFact.id }) as ReturnType<typeof import("../src/core/records.ts").provenance>;
  assert.equal(context.provenance.actor, agent.name); assert.equal(context.provenance.rev, 2);
  assert.equal(context.last_edited.actor, admin.name); assert.equal(context.citation_provenance.rev, 3);
  assert.equal(context.original.body.value, 4);

  assert.equal((run(co, admin, "record.create", { kind: "issue_note", body: { title: "New note" } }) as Rec).kind, "issue_note");
});
