import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { addAgent, issueKey } from "../src/core/agents.ts";
import { Companies } from "../src/core/companies.ts";
import { NodeDb } from "../src/core/db.ts";
import { RsError } from "../src/core/errors.ts";
import { People, SESSION_COOKIE } from "../src/core/people.ts";
import { parseReadOnly } from "../src/core/read-only.ts";
import { reviewEvidence } from "../src/operations/curator.ts";
import { operations, run } from "../src/operations/index.ts";
import { startServer } from "../src/server.ts";
import { webFor } from "../src/web/service.ts";
import { admin, rec } from "./helpers.ts";

const PASSWORD = "long-read-only-test-password";
const EMAIL = "alex@example.test";
const BUILD = join(import.meta.dirname, "..", "build", "handler.js");
const denied = (e: unknown) => e instanceof RsError && e.code === "read_only";

// Compare all rows, including auth audit, ledgers, counters, links, FTS and Curator metadata.
function rows(dir: string) {
  return readdirSync(dir).filter(f => f.endsWith(".sqlite") && !f.endsWith(".agent.sqlite")).sort().map(file => {
    const db = new DatabaseSync(join(dir, file), { readOnly: true });
    try {
      const tables = db.prepare("select name from sqlite_master where type='table' order by name").all() as { name: string }[];
      return [file, tables.map(({ name }) => [name, db.prepare(`select * from "${name.replaceAll('"', '""')}"`).all()])];
    } finally { db.close(); }
  });
}
function files(dir: string) {
  return readdirSync(dir).sort().map(f => [f, createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")]);
}
async function fixture(t: TestContext, trust: "none" | "loopback" = "none") {
  const dir = mkdtempSync(join(tmpdir(), "rs-read-only-"));
  const companies = new Companies(dir);
  const co = companies.create("acme", "Acme");
  companies.create("other", "Other");
  addAgent(co, "admin-agent", "admin");
  const key = issueKey(co, "admin-agent");
  addAgent(companies.get("other"), "reader", "viewer");
  const otherKey = issueKey(companies.get("other"), "reader");
  const project = rec(co, admin, "record.create", { kind: "project", body: { title: "Historical project" } });
  rec(co, admin, "record.patch", { ref: project.key, set: { current_state: "Verified source" } }, "prior-op-0001");
  const blob = run(co, admin, "blob.put", { b64: Buffer.from("historical attachment").toString("base64") }) as { sha256: string };
  co.run("insert into curator_runs(duty,started_at,status,detail) values ('review','2026-10-01','done','Historical review')");
  const people = People.open(dir);
  await people.add("alex", EMAIL, { password: PASSWORD });
  const token = (await people.signIn(EMAIL, PASSWORD, "127.0.0.1"))!;
  const reset = people.makeReset(EMAIL);
  people.close(); companies.close();
  // A preexisting agent file must never be opened or resumed in read-only mode.
  writeFileSync(join(dir, "acme.agent.sqlite"), "do not open this agent storage");
  writeFileSync(join(dir, "model.key"), "historical-test-key");
  const before = rows(dir), bytes = files(dir);
  const s = await startServer({ dataDir: dir, port: 0, host: "127.0.0.1", trust, readOnly: true, tick: 0.01, faux: fauxProvider() });
  t.after(async () => { await s.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${s.port}`;
  const call = (path: string, body?: unknown, apiKey = key) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": "prior-op-0001" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const unchanged = () => { assert.deepEqual(rows(dir), before); assert.deepEqual(files(dir), bytes); };
  return { ...s, dir, base, call, key, otherKey, project, blob, token, reset, unchanged };
}

const writes: Record<string, unknown> = {
  "record.create": { kind: "project", body: { title: "Denied" } },
  "record.patch": { ref: "PRJ-0001", set: { current_state: "Denied" } },
  "record.archive": { ref: "PRJ-0001" }, "record.restore": { ref: "PRJ-0001" }, "record.undo": { ref: "PRJ-0001" },
  "journal.log": { title: "Denied", project: "PRJ-0001" }, "company.update": { brief: "Denied" },
  "agent.add": { name: "denied" }, "agent.key": { name: "admin-agent" }, "agent.revoke": { name: "admin-agent" },
  "agent.set_active": { name: "admin-agent", active: false }, "blob.put": { b64: "eA==" },
  "curator.review": {}, "curator.flag": { title: "Denied", detail: "Denied", evidence: ["PRJ-0001"] },
  "curator.briefing": { title: "Denied", text: "Denied" },
};

test("read-only: every HTTP and MCP mutation fails without changing any data; authenticated POST reads work", async t => {
  const s = await fixture(t);
  assert.deepEqual(operations.filter(o => o.write).map(o => o.name).sort(), Object.keys(writes).sort());
  for (const [name, input] of Object.entries(writes)) {
    const response = await s.call(`/v1/op/${name}`, input);
    assert.equal(response.status, 403, name);
    assert.equal((await response.json()).error.code, "read_only", name);
    s.unchanged();
    const rpc = await s.call("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: name.replaceAll(".", "_"), arguments: input } });
    const result = (await rpc.json()).result;
    assert.equal(result.isError, true, name);
    assert.match(result.content[0].text, /^read_only:/, name);
    s.unchanged();
  }
  const health = await (await s.call("/health")).json();
  assert.equal(health.ok, true); assert.equal(health.readOnly, true);
  assert.deepEqual((await (await s.call("/v1/me")).json()).company, { slug: "acme", name: "Acme" });
  assert.equal((await s.call("/v1/me", undefined, "bad-key")).status, 401);
  assert.equal((await s.call("/v1/op/record.create", writes["record.create"], "bad-key")).status, 401);
  assert.equal((await s.call("/v1/op/record.get", { ref: s.project.key }, s.otherKey)).status, 404);
  const reads: Record<string, unknown> = {
    "record.get": { ref: s.project.key }, "record.context": { ref: s.project.key }, "record.list": {},
    "record.search": { q: "Historical" }, "record.history": { ref: s.project.key }, "record.links": { ref: s.project.key },
    "changes.since": { since: 0 }, "kind.list": {}, "project.context": { ref: s.project.key }, "brief.get": {},
    "journal.list": {}, "activity.list": {}, "archive.list": {}, "company.get": {}, "agent.list": {},
    "blob.get": { sha256: s.blob.sha256 }, "curator.scan": {},
  };
  assert.deepEqual(operations.filter(o => !o.write).map(o => o.name).sort(), Object.keys(reads).sort());
  for (const [name, input] of Object.entries(reads)) {
    assert.equal((await s.call(`/v1/op/${name}`, input)).status, 200, name);
    const rpc = await s.call("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: name.replaceAll(".", "_"), arguments: input } });
    assert.equal((await rpc.json()).result.isError, false, name);
  }
  const history = (await (await s.call("/v1/op/record.history", { ref: s.project.key })).json()).result;
  assert.deepEqual(history.map((r: { actor: string }) => r.actor), ["alex", "alex"]);
  for (const method of ["initialize", "ping", "tools/list"]) {
    assert.ok((await (await s.call("/mcp", { jsonrpc: "2.0", id: 3, method })).json()).result);
  }
  assert.equal((await s.call("/v1/operations")).status, 200);
  // Even retries of previously committed writes are denied.
  assert.equal((await s.call("/v1/op/record.patch", { ref: s.project.key, set: { current_state: "Verified source" } })).status, 403);
  s.unchanged();
});

test("read-only: all web form actions and chat mutations fail, while existing sessions and trusted reads work", async t => {
  assert.ok(existsSync(BUILD), "build the web app before this critical test");
  for (const trust of ["none", "loopback"] as const) {
    const s = await fixture(t, trust);
    const headers = { cookie: `${SESSION_COOKIE}=${s.token}`, origin: s.base, "content-type": "application/x-www-form-urlencoded" };
    const actions: Record<string, string[]> = {
      "/setup": ["account", "company"], "/login": [""], "/reset": [""],
      "/account": ["password", "set", "account", "signout"],
      "/c/acme/admin": ["setKey", "newCompany", "settings", "duty", "brief", "addAgent", "newKey", "revoke"],
      "/c/acme/curator": ["review", "say", "stop", "new"], "/c/acme/journal": ["log"],
      "/c/acme/r/PRJ-0001": ["patch", "archive", "restore", "undo"],
      ...Object.fromEntries(["projects", "sources", "facts", "knowledge", "issues"].map(p => [`/c/acme/${p}`, ["create"]])),
    };
    for (const [path, names] of Object.entries(actions)) for (const name of names) {
      const r = await fetch(s.base + path + (name ? `?/${name}` : ""), { method: "POST", headers, body: "title=Denied", redirect: "manual" });
      assert.equal(r.status, 403, `${trust}: ${path}/${name}`);
      assert.equal((await r.json()).error.code, "read_only");
      assert.equal(r.headers.getSetCookie().length, 0);
      s.unchanged();
    }
    // This form POST validates a key but persists nothing. Empty input avoids a remote call.
    const keyTest = await fetch(s.base + "/c/acme/admin?/testKey", { method: "POST", headers, body: "key=", redirect: "manual" });
    assert.equal(keyTest.status, 400);
    assert.match(await keyTest.text(), /No key given/);
    s.unchanged();
    assert.equal((await fetch(s.base + "/setup?/testKey", { method: "POST", headers: { ...headers, accept: "text/html" }, body: "key=", redirect: "manual" })).status, 303, "existing setup redirects normally; the read action is accepted");
    for (const query of ["?/testKey&/setKey", "?/setKey&/testKey", "?/testKey&/testKey", "?/testKey&extra=1"]) {
      assert.equal((await fetch(s.base + "/c/acme/admin" + query, { method: "POST", headers, body: "key=Denied" })).status, 403);
      s.unchanged();
    }
    for (const body of [{ text: "Denied" }, { text: "Denied", steer: true }, { stop: true }, { new: true }]) {
      assert.equal((await fetch(s.base + "/api/c/acme/chat", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) })).status, 403);
      s.unchanged();
    }
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.equal((await fetch(s.base + "/c/acme/admin", { method, headers })).status, 403);
    }
    for (const path of ["/c/acme", "/account", "/api/c/acme/chat", ...["projects", "r/PRJ-0001", "sources", "facts", "knowledge", "issues", "journal", "curator", "archive", "search", "activity", "admin"].map(p => `/c/acme/${p}`)]) {
      const r = await fetch(s.base + path, { headers, redirect: "manual" });
      assert.equal(r.status, 200, `${trust}: ${path}: ${await r.text()}`);
    }
    assert.equal((await fetch(s.base + "/c/acme", { method: "HEAD", headers })).status, 200);
    if (trust === "none") {
      const anonymous = await fetch(s.base + "/c/acme", { redirect: "manual" });
      assert.equal(anonymous.status, 303); assert.equal(anonymous.headers.get("location"), "/login");
    }
    s.unchanged();
  }
});

test("read-only: storage, web service, auth and background writers cannot bypass request guards", async t => {
  const s = await fixture(t);
  const co = s.companies.get("acme");
  assert.throws(() => s.companies.create("new", "Denied"), denied);
  assert.throws(() => co.run("insert into meta values ('denied','yes')"), denied);
  assert.throws(() => co.tx(() => 1), denied);
  // SQLite enforces read-only even if a future reader tries a write with RETURNING.
  assert.throws(() => co.one("insert into meta values ('denied','yes') returning *"), /readonly/);
  assert.throws(() => co.all("insert into meta values ('denied','yes') returning *"), /readonly/);
  const db = new NodeDb(join(s.dir, "acme.sqlite"), { readOnly: true });
  try { assert.throws(() => db.exec("create table denied(x)"), denied); assert.throws(() => db.run("insert into meta values ('denied','yes')"), denied); } finally { db.close(); }
  const p = s.people;
  assert.deepEqual(p.session(s.token), { name: "alex", email: EMAIL });
  const authWrites = [() => p.add("new", "new@example.test", { password: PASSWORD }), () => p.signIn(EMAIL, PASSWORD, "test"),
    () => p.signIn(EMAIL, "bad", "test"), () => p.signOut(s.token, "test"), () => p.makeReset(EMAIL),
    () => p.changePassword(s.token, PASSWORD, PASSWORD, PASSWORD, "test"), () => p.setPasswordOf("alex", PASSWORD, PASSWORD),
    () => p.useReset(s.reset, PASSWORD, PASSWORD, "test"), () => p.useReset("bad", PASSWORD, PASSWORD, "test")];
  for (const write of authWrites) { await assert.rejects(async () => write(), denied); s.unchanged(); }
  const req = { headers: { cookie: `${SESSION_COOKIE}=${s.token}` }, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage;
  const web = webFor(req, { companies: s.companies, people: p, curator: s.curator, dataDir: s.dir, trusted: true });
  const serviceWrites = [() => web.createCompany("new", "Denied"), () => web.modelKey.set("Denied"), () => web.setup("new", EMAIL, PASSWORD),
    () => web.signIn(EMAIL, PASSWORD), () => web.signOut(), () => web.setAccount("new", EMAIL, PASSWORD, PASSWORD),
    () => web.setPassword(PASSWORD, PASSWORD), () => web.changePassword(PASSWORD, PASSWORD, PASSWORD), () => web.useReset(s.reset, PASSWORD, PASSWORD),
    () => web.curator.say("acme", "Denied"), () => web.curator.stop("acme"), () => web.curator.newChat("acme"),
    () => web.curator.saveSettings("acme", { auto: true }), ...(["review", "briefing", "upkeep"] as const).map(d => () => web.curator.runDuty("acme", d))];
  for (const write of serviceWrites) { await assert.rejects(async () => write(), denied); s.unchanged(); }
  assert.equal(web.run("acme", "record.create", writes["record.create"]).ok, false);
  assert.equal(web.run("acme", "record.get", { ref: s.project.key }).ok, true);
  assert.equal((await web.curator.view("acme")).runs[0]?.detail, "Historical review");
  assert.equal(s.curator.available, false);
  assert.throws(() => s.curator.enable(), denied);
  await assert.rejects(async () => s.curator.for("acme"), denied);
  assert.throws(() => reviewEvidence(co), denied);
  s.curator.start(0.001);
  assert.deepEqual(await s.curator.tick(), []);
  await new Promise(resolve => setTimeout(resolve, 40));
  s.unchanged();
});

test("read-only: flag parsing is explicit, default behavior writes, and old schemas never migrate", async t => {
  for (const v of [undefined, "false", "0"]) assert.equal(parseReadOnly(v), false);
  for (const v of ["true", "1"]) assert.equal(parseReadOnly(v), true);
  for (const v of ["", "yes", "TRUE", "typo"]) assert.throws(() => parseReadOnly(v), /RS_READ_ONLY/);
  const dir = mkdtempSync(join(tmpdir(), "rs-read-only-schema-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const companies = new Companies(dir);
  const co = companies.create("acme", "Acme");
  addAgent(co, "agent", "admin");
  const key = run(co, admin, "agent.key", { name: "agent" }, "no-secret-ledger") as { key: string };
  assert.ok(companies.authenticate(key.key));
  assert.deepEqual(co.all("select * from ops"), [], "key material never enters the ledger");
  co.run("update meta set v='4' where k='schema_version'"); companies.close();
  const p = People.open(dir); p.close();
  const beforeRows = rows(dir), before = files(dir);
  await assert.rejects(startServer({ dataDir: dir, port: 0, host: "127.0.0.1", readOnly: true, faux: fauxProvider() }), /needs migration/);
  assert.deepEqual(rows(dir), beforeRows);
  assert.deepEqual(files(dir), before);
  const missing = join(dir, "missing");
  assert.throws(() => People.open(missing, { readOnly: true }));
  assert.equal(existsSync(missing), false);
});

test("read-only: the environment enables the server and operator guards; disabled and unset retain writes", async t => {
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "rs-read-only-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const companies = new Companies(dir), co = companies.create("acme", "Acme");
  addAgent(co, "admin", "admin"); const key = issueKey(co, "admin"); companies.close();
  const people = People.open(dir); await people.add("alex", EMAIL, { password: PASSWORD }); people.close();
  const prior = process.env.RS_READ_ONLY;
  try {
    process.env.RS_READ_ONLY = "1";
    const s = await startServer({ dataDir: dir, port: 0, host: "127.0.0.1", faux: fauxProvider() });
    try {
      assert.equal(s.readOnly, true);
      const r = await fetch(`http://127.0.0.1:${s.port}/v1/op/record.create`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(writes["record.create"]) });
      assert.equal(r.status, 403);
    } finally { await s.close(); }
    const before = rows(dir), bytes = files(dir);
    for (const args of [["company", "create", "new", "Denied"], ["agent", "add", "acme", "new"], ["agent", "key", "acme", "admin", "--out", join(dir, "denied.key")], ["person", "add", "new", "new@example.test"], ["person", "reset", EMAIL]]) {
      const r = spawnSync(process.execPath, ["src/admin.ts", ...args], { cwd: join(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: dir }, input: PASSWORD + "\n", encoding: "utf8" });
      assert.equal(r.status, 1, args.join(" "));
      assert.match(r.stderr, /read-only/);
      assert.deepEqual(rows(dir), before); assert.deepEqual(files(dir), bytes);
    }
    for (const value of ["0", undefined]) {
      if (value === undefined) delete process.env.RS_READ_ONLY; else process.env.RS_READ_ONLY = value;
      const s = await startServer({ dataDir: dir, port: 0, host: "127.0.0.1", faux: fauxProvider() });
      try { assert.equal(s.readOnly, false); assert.ok(rec(s.companies.get("acme"), admin, "record.create", { kind: "project", body: { title: "Allowed" } }).id); }
      finally { await s.close(); }
    }
    process.env.RS_READ_ONLY = "typo";
    await assert.rejects(startServer({ dataDir: join(dir, "missing"), port: 0, host: "127.0.0.1" }), /RS_READ_ONLY/);
    assert.equal(existsSync(join(dir, "missing")), false);
  } finally {
    if (prior === undefined) delete process.env.RS_READ_ONLY; else process.env.RS_READ_ONLY = prior;
  }
});
