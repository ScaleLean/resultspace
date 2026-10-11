// The real `rs` program against a real server, the way agents run it.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { addAgent, issueKey } from "../src/core/agents.ts";
import { startServer } from "../src/server.ts";

type Json = Record<string, unknown>;

async function world(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "rs-cli-"));
  const s = await startServer({ dataDir: join(dir, "data"), port: 0, host: "127.0.0.1" });
  t.after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const config = [`server_url = "http://127.0.0.1:${s.port}"`, `default_company = "acme"`];
  for (const [slug, name, agent, role] of [
    ["acme", "Acme", "hermes:acme", "member"],
    ["other-co", "Other Co", "hermes:acme", "viewer"],
  ] as const) {
    const co = s.companies.create(slug, name);
    addAgent(co, agent, role);
    if (slug === "acme") addAgent(co, "boss", "admin");
    writeFileSync(join(dir, `${slug}.key`), issueKey(co, agent), { mode: 0o600 });
    config.push(`[companies.${slug}]`, `key_file = "${join(dir, `${slug}.key`)}"`);
  }
  writeFileSync(join(dir, "cli.toml"), config.join("\n"));
  type Ran = { code: number; out: string; err: string; json: () => { ok: boolean; command: string; data: Json; error?: Json } };
  // Not spawnSync: the server lives in this process and must stay free to answer.
  const rs = (...args: string[]) =>
    new Promise<Ran>((ok) => {
      const child = execFile(
        process.execPath,
        [join(import.meta.dirname, "..", "src", "cli", "rs.ts"), ...args],
        { env: { ...process.env, RS_CONFIG: join(dir, "cli.toml") }, encoding: "utf8" },
        (_e, out, err) => ok({ code: child.exitCode ?? 1, out, err, json: () => JSON.parse(out) as ReturnType<Ran["json"]> }),
      );
    });
  return { dir, s, rs };
}

test("rs: retained CRUD exposes company scope and server attribution", async (t) => {
  const { rs } = await world(t);
  assert.equal((await rs("whoami", "--json")).code, 0);
  const companies = (await rs("--json", "--online", "companies")).json();
  assert.deepEqual(
    (companies.data.companies as Json[]).map((c) => [c.slug, c.role]),
    [
      ["acme", "member"],
      ["other-co", "viewer"],
    ],
  );
  const made = (
    await rs(
      "--json",
      "--online",
      "new",
      "-C",
      "acme",
      "note",
      "--body",
      JSON.stringify({ title: "Run 1", note_type: "prime_reconcile", run_key: "r1" }),
    )
  ).json();
  assert.equal(made.data.key, "JNL-0001");
  assert.equal((await rs("--json", "--online", "set", "-C", "acme", "JNL-0001", 'summary:={"n":2}', "run_key=r2")).code, 0);
  const shown = (await rs("--json", "--online", "show", "-C", "acme", "JNL-0001")).json();
  assert.deepEqual(((shown.data.record as Json).body as Json).summary, { n: 2 });
  const listed = (await rs("--json", "--online", "ls", "note", "-C", "acme")).json();
  const first = (listed.data.records as Json[])[0]!;
  assert.deepEqual(Object.keys(first).sort(), ["archived", "body", "company_id", "created_at", "id", "key", "kind", "rev", "status", "title", "updated_at", "updated_by"]);
  assert.equal(first.updated_by,"hermes:acme");
  assert.equal(first.title, "Run 1");
  assert.equal((first.body as Json).run_key, "r2");
});

test("rs: exit codes and the company wall", async (t) => {
  const { rs } = await world(t);
  assert.equal((await rs("show", "NOPE-0001")).code, 4);
  const missing = (await rs("--json", "show", "NOPE-0001")).json();
  assert.equal(missing.ok, false);
  assert.equal((missing.error as Json).code, 4);
  assert.equal((await rs("nonsense")).code, 2);
  assert.equal((await rs("ls")).code, 2);
  assert.equal((await rs("new", "task", "status=todo")).code, 6, "a rule refused it");
  assert.equal((await rs("new", "note", "title=x", "-C", "other-co")).code, 4, "viewer in the other company");
  assert.equal((await rs("ls", "note", "-C", "third-co")).code, 4, "a company this profile has no key for");
  await rs("new", "note", "title=Acme secret");
  assert.match((await rs("ls", "note", "-C", "other-co")).out, /\(none\)/);
  assert.equal((await rs("show", "JNL-0001", "-C", "other-co")).code, 4);
});

test("real API + CLI focused project read and sourced record path", async (t) => {
  const { s, rs } = await world(t);
  let made = await rs(
    "new",
    "project",
    "title=Launch",
    "goal=Confirm supply",
    'objectives:=["Compare quotes"]',
    "current_state=Researching",
    "--json",
  );
  assert.equal(made.code, 0, made.err);
  const project = String(made.json().data.key);
  made = await rs(
    "new",
    "fact",
    "--body",
    JSON.stringify({
      title: "Lead time",
      subject: "Supplier A",
      predicate: "lead_time",
      value_type: "number",
      value: 4,
      unit: "weeks",
      source: "Quote dated Oct 11",
      project_id: project,
    }),
    "--json",
  );
  assert.equal(made.code, 0, made.err);
  const context = await rs("project", "context", project, "--json");
  assert.equal(context.code, 0, context.err);
  const data = context.json().data;
  assert.equal((data.facts as Json[]).length, 1);
  assert.equal(((data.project as Json).record as Json).key, project);
  const unsourced = await rs("log", "Unsupported learning", "--project", project, "--type", "learning", "--json");
  assert.notEqual(unsourced.code, 0);
  assert.match(unsourced.out + unsourced.err, /Learning needs a source/);
  const recorded = await rs(
    "log",
    "Quote confirmed",
    "--project",
    project,
    "--type",
    "learning",
    "--text",
    "Lead time is four weeks",
    "--source",
    "Supplier quote Oct 11",
    "--json",
  );
  assert.equal(recorded.code, 0, recorded.err);
  const key = String(recorded.json().data.key);
  const co = s.companies.get("acme");
  const { run } = await import("../src/operations/index.ts");
  const actor = { kind: "person", name: "alex", role: "admin" } as const;
  const history = run(co, actor, "record.history", { ref: key }) as Json[];
  assert.equal(history[0]!.actor, "hermes:acme");
  assert.equal((history[0]!.body as Json).source, "Supplier quote Oct 11");
  assert.equal((await rs("project", "context", project, "-C", "other-co", "--json")).code, 4);
  assert.equal((await rs("skills", "sync", "--json")).code, 2);
});

test("CLI Journal scope rejects conflicting project/about through log, generic creation and patch", async (t) => {
  const { rs } = await world(t);
  for (const name of ["A", "B"]) assert.equal((await rs("new", "project", `title=${name}`)).code, 0);
  assert.equal((await rs("new", "knowledge", "title=A claim", "body=Scoped A", "project_id=PRJ-0001")).code, 0);
  for (const about of ["PRJ-0001", "KNW-0001"]) {
    assert.notEqual((await rs("log", "Conflict", "--about", about, "--project", "PRJ-0002")).code, 0);
    assert.notEqual((await rs("new", "entry", "title=Conflict", `about_id=${about}`, "project_id=PRJ-0002")).code, 0);
  }
  const entry = await rs("log", "Inherited A", "--about", "KNW-0001", "--json");
  assert.equal(entry.code, 0, entry.err);
  assert.notEqual((await rs("set", String(entry.json().data.key), "project_id=PRJ-0002")).code, 0);
  assert.equal(((await rs("project", "context", "PRJ-0001", "--json")).json().data.log as Json[]).length, 1);
  assert.deepEqual((await rs("project", "context", "PRJ-0002", "--json")).json().data.log, []);
});

test("CLI and API Journal preserve legacy about keys and supply display titles", async (t) => {
  const { dir, s, rs } = await world(t);
  const co = s.companies.get("acme");
  const { legacyJournal } = await import("./fixtures/legacy-journal.ts");
  legacyJournal(co);
  const before = ["records", "revisions", "links"].map(table => co.all(`select * from ${table} order by 1`));
  const key = (await import("node:fs")).readFileSync(join(dir, "acme.key"), "utf8").trim();
  const response = await fetch(`http://127.0.0.1:${s.port}/v1/op/journal.list`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: "{}",
  });
  assert.equal(response.status, 200);
  const api = (await response.json()).result as Json[];
  const cli = await rs("journal", "--json", "--online");
  assert.equal(cli.code, 0, cli.err);
  const items = cli.json().data.items as Json[];
  assert.deepEqual(items, api);
  const missing = items.find(e => e.key === "JNL-0901")!;
  assert.equal(missing.type, "note");
  assert.equal((missing.about as Json).key, "KNW-0901");
  assert.equal((missing.about as Json).title, "Historical supplier evidence");
  const unknown = items.find(e => e.key === "JNL-0902")!;
  assert.equal(unknown.type, "legacy_observation");
  assert.equal((unknown.about as Json).key, "KNW-0902");
  assert.equal((unknown.about as Json).title, "KNW-0902");
  const text = await rs("journal", "--online");
  assert.equal(text.code, 0, text.err); assert.match(text.out, /Imported supplier observation/);
  assert.deepEqual(["records", "revisions", "links"].map(table => co.all(`select * from ${table} order by 1`)), before);
});
