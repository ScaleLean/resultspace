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
  t.after(async () => { await s.close(); rmSync(dir, { recursive: true, force: true }); });
  const config = [`server_url = "http://127.0.0.1:${s.port}"`, `default_company = "acme"`];
  for (const [slug, name, agent, role] of [["acme", "Acme", "hermes:acme", "member"], ["other-co", "Other Co", "hermes:acme", "viewer"]] as const) {
    const co = s.companies.create(slug, name);
    addAgent(co, agent, role);
    if (slug === "acme") addAgent(co, "boss", "admin");
    writeFileSync(join(dir, `${slug}.key`), issueKey(co, agent), { mode: 0o600 });
    config.push(`[companies.${slug}]`, `key_file = "${join(dir, `${slug}.key`)}"`);
  }
  writeFileSync(join(dir, "cli.toml"), config.join("\n"));
  type Ran = { code: number; out: string; err: string; json: () => { ok: boolean; command: string; data: Json; error?: Json } };
  // Not spawnSync: the server lives in this process and must stay free to answer.
  const rs = (...args: string[]) => new Promise<Ran>((ok) => {
    const child = execFile(process.execPath, [join(import.meta.dirname, "..", "src", "cli", "rs.ts"), ...args], { env: { ...process.env, RS_CONFIG: join(dir, "cli.toml") }, encoding: "utf8" },
      (_e, out, err) => ok({ code: child.exitCode ?? 1, out, err, json: () => JSON.parse(out) as ReturnType<Ran["json"]> }));
  });
  return { dir, s, rs };
}

test("rs: the commands scripts run today keep their shapes", async (t) => {
  const { rs } = await world(t);
  assert.equal((await rs("whoami", "--json")).code, 0);
  const companies = (await rs("--json", "--online", "companies")).json();
  assert.deepEqual((companies.data.companies as Json[]).map((c) => [c.slug, c.role]), [["acme", "member"], ["other-co", "viewer"]]);
  const made = (await rs("--json", "--online", "new", "-C", "acme", "note", "--body", JSON.stringify({ title: "Run 1", note_type: "prime_reconcile", run_key: "r1" }))).json();
  assert.equal(made.data.key, "JNL-0001");
  assert.equal((await rs("--json", "--online", "set", "-C", "acme", "JNL-0001", "summary:={\"n\":2}", "run_key=r2")).code, 0);
  const shown = (await rs("--json", "--online", "show", "-C", "acme", "JNL-0001")).json();
  assert.deepEqual(((shown.data.record as Json).body as Json).summary, { n: 2 });
  const listed = (await rs("--json", "--online", "ls", "note", "-C", "acme")).json();
  const first = (listed.data.records as Json[])[0]!;
  assert.deepEqual(Object.keys(first).sort(), ["archived", "body", "company_id", "conflict", "id", "key", "kind", "pending_ops", "rev", "status", "sync_state", "title"]);
  assert.equal(first.title, "Run 1");
  assert.equal((first.body as Json).run_key, "r2");
});

test("rs: what agents type from their skills", async (t) => {
  const { rs, s } = await world(t);
  const acme = s.companies.get("acme");
  assert.match((await rs("brief")).out, /## Acme \(acme\)/);
  assert.match((await rs("new", "project", "title=Launch", "status=active")).out, /created PRJ-0001/);
  assert.match((await rs("task", "add", "Call supplier", "--project", "PRJ-0001")).out, /created TSK-0001/);
  assert.equal((await rs("set", "TSK-0001", "status=in_progress", "priority=high", "budget_cents:=50000")).code, 0);
  assert.equal((await rs("task", "done", "TSK-0001", "--result", "Supplier confirmed 4-week lead time")).code, 0);
  assert.match((await rs("results")).out, /Supplier confirmed 4-week lead time/);
  assert.match((await rs("ls", "task", "--status", "done")).out, /TSK-0001\s+Call supplier\s+done/);
  assert.match((await rs("note", "add", "Weekly check", "--text", "all quiet", "--online")).out, /noted JNL-000\d/);
  assert.match((await rs("ask", "supplier")).out, /TSK-0001/);
  assert.match((await rs("search", "nothing-like-this")).out, /Not on record/);
  // An assignment handed to this agent.
  const { run } = await import("../src/operations/index.ts");
  run(acme, { kind: "person", name: "alex", role: "admin" }, "record.create", { kind: "assignment", body: { title: "Check label", owner: "hermes:acme", project_id: "PRJ-0001" } });
  assert.match((await rs("assignment")).out, /ASG-0001\s+Waiting for the agent/);
  assert.match((await rs("assignment", "next")).out, /It is yours/);
  assert.equal((await rs("assignment", "start", "ASG-0001", "--progress", "Reading the formula")).code, 0);
  assert.match((await rs("act", "publish", "--detail", "Updated listing copy", "--assignment", "ASG-0001")).out, /recorded JNL-000\d/);
  assert.equal((await rs("assignment", "report", "ASG-0001")).code, 2, "a report needs --result");
  const reported = await rs("assignment", "report", "ASG-0001", "--result", "Label matches the formula");
  assert.equal(reported.code, 0);
  assert.match(reported.out, /reported_by\s+hermes:acme/);
  assert.match(reported.out, /verification\s+not verified/, "a reported result says it is not verified");
  assert.match((await rs("asg")).out, /No open assignments/);
  assert.equal((await rs("assignment", "verify", "ASG-0001")).code, 4, "an agent cannot verify");
  assert.match((await rs("today")).out, /Label matches the formula/);
  assert.match((await rs("activity", "--since", "24h")).out, /ASG-0001/);
  assert.match((await rs("help", "assignments")).out, /not a project \(a body of work\) and not a task/);
  assert.equal((await rs("sync")).code, 0);
  assert.match((await rs("doctor")).out, /All good/);
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
  (await rs("new", "note", "title=Acme secret"));
  assert.match((await rs("ls", "note", "-C", "other-co")).out, /\(none\)/);
  assert.equal((await rs("show", "JNL-0001", "-C", "other-co")).code, 4);
});

// The two company HUDs run `rs today --json` and `rs work --json` and refuse any output with a warning.
// `rs work` must keep its JSON (work_orders, work_order) and never warn, whatever server it talks to.
test("rs: old `rs work` JSON stays as it was; `rs assignment` is the new contract", async (t) => {
  const { rs, s } = await world(t);
  const { run } = await import("../src/operations/index.ts");
  const boss = { kind: "person", name: "alex", role: "admin" } as const;
  run(s.companies.get("acme"), boss, "record.create", { kind: "work_order", body: { title: "Old caller", owner: "hermes:acme" } });

  const work = await rs("work", "--json");
  const w = work.json() as unknown as { ok: boolean; command: string; data: { work_orders: Json[] }; warnings: unknown[] };
  assert.deepEqual([work.code, w.ok, w.command, w.warnings, Object.keys(w.data)], [0, true, "work", [], ["work_orders"]]);
  assert.equal(work.err, "", "nothing on stderr with --json");
  const first = w.data.work_orders[0]!;
  for (const field of ["id", "key", "rev", "title", "owner", "status", "status_words", "brief", "result", "progress", "answer", "due_on", "project", "updated_at"]) assert.ok(field in first, field);
  assert.deepEqual([first.key, first.status], ["ASG-0001", "queued"]);
  assert.match((await rs("work")).err, /`rs work` is now `rs assignment`/, "people get a note on stderr");

  const next = (await rs("work", "next", "--json")).json() as unknown as { data: { work_order: Json; claimed: boolean }; warnings: unknown[] };
  assert.deepEqual([next.data.work_order.key, next.data.claimed, next.warnings], ["ASG-0001", true, []]);
  assert.deepEqual(Object.keys(((await rs("work", "start", "ASG-0001", "--json")).json() as unknown as { data: Json }).data), ["work_order"]);
  assert.equal((await rs("act", "ads", "--detail", "Raised the budget", "--wo", "ASG-0001", "--json")).code, 0);
  assert.equal((await rs("act", "ads", "--detail", "x", "--wo", "ASG-0001", "--assignment", "JNL-0001")).code, 2);
  const today = (await rs("today", "--json")).json() as unknown as { data: Record<string, unknown>; warnings: unknown[] };
  assert.deepEqual([Object.keys(today.data).sort(), today.warnings], [["actions", "needs_you", "open_work", "results"], []]);
  assert.equal((today.data.actions as Json[])[0]?.detail, "Raised the budget");

  const list = (await rs("assignment", "--json")).json() as unknown as { data: { assignments: (Json & { verification: Json })[] }; warnings: unknown[] };
  assert.deepEqual([Object.keys(list.data), list.data.assignments[0]?.key, list.data.assignments[0]?.kind, list.data.assignments[0]?.verification.state, list.warnings],
    [["assignments"], "ASG-0001", "assignment", "not_verified", []]);
  const shown = (await rs("assignment", "show", "ASG-0001", "--json")).json() as unknown as { data: { assignment: Json } };
  assert.deepEqual(["outcomes", "sessions", "actions"].map((k) => (shown.data.assignment[k] as unknown[]).length), [0, 0, 1]);
  const done = (await rs("work", "report", "ASG-0001", "--result", "Budget is $60/day", "--json")).json() as unknown as { data: { work_order: Json } };
  assert.equal(done.data.work_order.status, "done");
  const old = (await rs("work", "show", "ASG-0001", "--json")).json() as unknown as { data: { work_order: Json } };
  assert.deepEqual(["results", "receipts", "actions"].map((k) => (old.data.work_order[k] as unknown[]).length), [1, 0, 1], "work show keeps results and receipts");
  assert.deepEqual(((await rs("ls", "work_order", "--all", "--json")).json() as unknown as { data: { records: Json[] } }).data.records.map((r) => r.kind), ["assignment"]);
});
