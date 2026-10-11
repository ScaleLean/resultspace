import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { addAgent, issueKey } from "../src/core/agents.ts";
import { handleApi } from "../src/surfaces/http.ts";
import { admin, rec, setup } from "./helpers.ts";

type Json = Record<string, unknown>;

async function serve(t: TestContext) {
  const s = setup(t);
  addAgent(s.acme, "hermes:acme");
  addAgent(s.acme, "reader", "viewer");
  addAgent(s.other, "hermes:other");
  const keys = { acme: issueKey(s.acme, "hermes:acme"), reader: issueKey(s.acme, "reader"), other: issueKey(s.other, "hermes:other") };
  const server = createServer(
    (req, res) =>
      void handleApi(s.companies, req, res).then((mine) => {
        if (!mine) res.writeHead(404).end();
      }),
  );
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (key: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (r.status === 202 ? {} : await r.json()) as Json };
  };
  return { ...s, keys, call };
}

test("api: a key reaches its own company and nothing else", async (t) => {
  const { keys, call } = await serve(t);
  assert.equal((await call(null, "GET", "/health")).status, 200);
  assert.equal((await call(null, "GET", "/v1/me")).status, 401);
  assert.equal((await call("rsk_acme_" + "x".repeat(32), "GET", "/v1/me")).status, 401);
  const me = await call(keys.acme, "GET", "/v1/me");
  assert.deepEqual(me.body.company, { slug: "acme", name: "Acme" });
  const made = await call(keys.acme, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "Acme only" } });
  assert.equal(made.status, 200);
  const key = (made.body.result as Json).key as string;
  // The other company's key asks for the same record key and search word: it is simply not there.
  assert.equal((await call(keys.other, "POST", "/v1/op/record.get", { ref: key })).status, 404);
  assert.deepEqual((await call(keys.other, "POST", "/v1/op/record.search", { q: "Acme" })).body.result, []);
});

test("api: errors carry a code, roles are enforced, repeats are safe", async (t) => {
  const { keys, call } = await serve(t);
  const denied = await call(keys.reader, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "x" } });
  assert.equal(denied.status, 403);
  assert.equal((denied.body.error as Json).code, "forbidden");
  assert.equal((await call(keys.acme, "POST", "/v1/op/record.create", { kind: "entry" })).status, 400);
  assert.equal((await call(keys.acme, "POST", "/v1/op/nope", {})).status, 404);
  const once = { "idempotency-key": "op-http-0001" };
  const a = await call(keys.acme, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "Once" } }, once);
  const b = await call(keys.acme, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "Once" } }, once);
  assert.deepEqual(b.body, a.body);
  assert.equal((await call(keys.acme, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "Other" } }, once)).status, 409);
  assert.equal(((await call(keys.acme, "POST", "/v1/op/record.list", { kind: "entry" })).body.result as unknown[]).length, 1);
  const ops = (await call(keys.reader, "GET", "/v1/operations")).body.operations as Json[];
  assert.ok(ops.some((o) => o.name === "record.create" && (o.input as Json).type === "object"));
});

test("mcp: the operation list as tools, with the key's rights", async (t) => {
  const { keys, call } = await serve(t);
  const rpc = (key: string, id: number | null, method: string, params: Json = {}) =>
    call(key, "POST", "/mcp", { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params });
  const init = await rpc(keys.acme, 1, "initialize", { protocolVersion: "2025-06-18" });
  assert.equal(((init.body.result as Json).serverInfo as Json).name, "resultspace");
  assert.equal((await rpc(keys.acme, null, "notifications/initialized")).status, 202);
  const tools = ((await rpc(keys.acme, 2, "tools/list")).body.result as Json).tools as Json[];
  assert.ok(tools.some((x) => x.name === "record_search"));
  const made = (await rpc(keys.acme, 3, "tools/call", { name: "record_create", arguments: { kind: "entry", body: { title: "From MCP" } } }))
    .body.result as Json;
  assert.equal(made.isError, false);
  const refused = (await rpc(keys.reader, 4, "tools/call", { name: "record_create", arguments: { kind: "entry", body: { title: "x" } } }))
    .body.result as Json;
  assert.equal(refused.isError, true);
  assert.match(((refused.content as Json[])[0] as Json).text as string, /^forbidden/);
  assert.equal(((await rpc(keys.acme, 5, "nope")).body.error as Json).code, -32601);
  assert.equal((await call(null, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
});

test("log and project context credit a second authenticated editor while preserving the original assertion", async (t) => {
  const { acme, keys, call } = await serve(t);
  addAgent(acme, "editor", "member");
  const editorKey = issueKey(acme, "editor");
  const project = (await call(keys.acme, "POST", "/v1/op/record.create", { kind: "project", body: { title: "Launch" } })).body
    .result as Json;
  const original = (
    await call(keys.acme, "POST", "/v1/op/journal.log", {
      title: "Launch succeeded",
      type: "outcome",
      detail: "Supplier confirmed",
      project: project.key,
    })
  ).body.result as Json;
  const edited = await call(editorKey, "POST", "/v1/op/record.patch", {
    ref: original.key,
    set: { title: "Launch uncertain", type: "note", detail: "Supplier withdrew confirmation" },
    why: "New supplier email",
  });
  assert.equal(edited.status, 200);
  const log = (await call(keys.acme, "POST", "/v1/op/journal.list", { project: project.key })).body.result as Json[];
  assert.equal(log[0]!.by, "editor");
  assert.equal(log[0]!.type, "note");
  assert.equal(log[0]!.title, "Launch uncertain");
  assert.equal(log[0]!.detail, "Supplier withdrew confirmation");
  assert.equal((log[0]!.original as Json).actor, "hermes:acme");
  assert.equal(((log[0]!.original as Json).body as Json).title, "Launch succeeded");
  assert.equal(((log[0]!.original as Json).body as Json).type, "outcome");
  const context = (await call(keys.acme, "POST", "/v1/op/project.context", { ref: project.key })).body.result as Json;
  const entry = (context.log as Json[])[0]!;
  assert.equal((entry.provenance as Json).actor, "editor");
  assert.equal((entry.provenance as Json).at, log[0]!.updated_at);
  assert.equal(((entry.record as Json).body as Json).title, log[0]!.title);
  const history = (await call(keys.acme, "POST", "/v1/op/record.history", { ref: original.key })).body.result as Json[];
  assert.deepEqual(
    history.map((r) => r.actor),
    ["hermes:acme", "editor"],
  );
  assert.equal((history[0]!.body as Json).detail, "Supplier confirmed");
  for (const input of [
    { title: "Uncited learning", type: "learning" },
    { title: "Whitespace citation", type: "learning", source: "  " },
  ])
    assert.equal((await call(keys.acme, "POST", "/v1/op/journal.log", input)).status, 400);
  assert.equal((await call(editorKey, "POST", "/v1/op/record.patch", { ref: original.key, set: { type: "learning" } })).status, 400,
    "generic patch cannot turn an unsourced note into learning");
});

test("canonical Journal scope rejects cross-project about/create/patch and keeps shared claim citations out of another log", async (t) => {
  const { acme, keys, call } = await serve(t);
  const op = async (name: string, input: Json) => call(keys.acme, "POST", `/v1/op/${name}`, input);
  const make = async (kind: string, body: Json) => (await op("record.create", { kind, body })).body.result as Json;
  const a = await make("project", { title: "Project A" });
  const b = await make("project", { title: "Project B" });
  const fact = await make("fact", { title: "A fact", subject: "Supplier", predicate: "weeks", value_type: "number", value: 4, project_id: a.key });
  const knowledge = await make("knowledge", { title: "A knowledge", body: "Scope A only", project_id: a.key });
  for (const about of [a, fact, knowledge]) {
    assert.equal((await op("journal.log", { title: "Bad scope", about: about.key, project: b.key })).status, 400);
    assert.equal((await op("record.create", { kind: "entry", body: { title: "Bad generic scope", about_id: about.key, project_id: b.key } })).status, 400);
    const entry = await make("entry", { title: "A event", about_id: about.key });
    assert.equal((entry.body as Json).project_id, a.id);
    assert.equal((await op("record.patch", { ref: entry.key, set: { project_id: b.key } })).status, 400);
    assert.equal((await op("record.patch", { ref: entry.key, set: { about_id: b.key } })).status, 400);
    assert.equal((await op("record.patch", { ref: entry.key, set: { title: `Mention ${String(b.key)}` } })).status, 200);
  }
  assert.equal((await op("record.patch", { ref: fact.key, set: { project_id: b.key } })).status, 400, "claim move cannot contradict dependent Journal scope");
  await op("record.patch", { ref: b.key, set: { fact_ids: [fact.key], knowledge_ids: [knowledge.key] } });
  const context = async (ref: unknown) => (await op("project.context", { ref })).body.result as Json;
  assert.equal(((await context(a.key)).log as Json[]).length, 3);
  assert.deepEqual((await context(b.key)).log, []);
  assert.equal(((await context(b.key)).facts as Json[]).length, 1, "a fact may be explicitly shared without sharing its Journal");
  assert.deepEqual((await op("journal.list", { project: b.key })).body.result, []);
  assert.equal((await op("record.patch", { ref: b.key, set: { current_state: "References JNL-0001" } })).status, 200);
  assert.deepEqual((await context(b.key)).log, [], "incidental backlinks never change Journal scope");
});

test("Journal scope anchors stay immutable for parent, child and transitive child through patch, undo and restore", async (t) => {
  const { acme, keys, call } = await serve(t);
  const op = (name: string, input: Json) => call(keys.acme, "POST", `/v1/op/${name}`, input);
  const make = async (kind: string, body: Json) => {
    const result = await op("record.create", { kind, body });
    assert.equal(result.status, 200);
    return result.body.result as Json;
  };
  const a = await make("project", { title: "Original scope" });
  const b = await make("project", { title: "Other scope" });
  const parent = await make("entry", { title: "Parent", about_id: a.key });
  const child = await make("entry", { title: "Child", about_id: parent.key });
  const descendant = await make("entry", { title: "Transitive child", about_id: child.key });
  const anchored = [parent, child, descendant];
  const visible = async () => {
    for (const entry of anchored) {
      const read = (await op("record.get", { ref: entry.key })).body.result as Json;
      assert.equal((read.body as Json).project_id, a.id);
      assert.equal((read.body as Json).about_id, (entry.body as Json).about_id);
    }
    const context = (await op("project.context", { ref: a.key })).body.result as Json;
    assert.deepEqual((context.log as Json[]).map(e => (e.record as Json).id).sort(), anchored.map(e => e.id).sort());
    const log = (await op("journal.list", { project: a.key })).body.result as Json[];
    assert.deepEqual(log.map(e => e.key).sort(), anchored.map(e => e.key).sort());
    assert.deepEqual(((await op("project.context", { ref: b.key })).body.result as Json).log, []);
    assert.deepEqual((await op("journal.list", { project: b.key })).body.result, []);
  };
  await visible();
  for (const entry of anchored) {
    for (const set of [
      { project_id: b.key, about_id: b.key }, { project_id: null }, { about_id: null },
      { about_id: entry.key }, { about_id: descendant.key },
    ]) {
      const attempt = await op("record.patch", { ref: entry.key, set });
      assert.equal(attempt.status, 400);
      assert.match(JSON.stringify(attempt.body), /immutable/);
    }
  }
  // Future/self references cannot create cycles; existing anchors cannot be changed to close a cycle.
  assert.equal((await op("record.create", { kind: "entry", body: { title: "Forward cycle", about_id: "JNL-9999" } })).status, 400);
  assert.equal((await op("record.create", { kind: "entry", body: { title: "Contradictory child", about_id: parent.key, project_id: b.key } })).status, 400);
  assert.equal((await op("record.patch", { ref: parent.key, set: { title: "Content correction", detail: "Ordinary editing remains available" } })).status, 200);
  assert.equal((await op("record.undo", { ref: parent.key })).status, 200, "content undo retains anchors");
  await visible();

  // Simulate an existing historical scope move and return, before anchors became immutable.
  const current = (await op("record.get", { ref: parent.key })).body.result as Json;
  const originalBody = current.body as Json;
  for (const [i, body] of [{ ...originalBody, project_id: b.id, about_id: b.id }, originalBody].entries())
    acme.run("insert into revisions(record_id,rev,body,archived,changed,op,actor,actor_kind,at) values (?,?,?,0,'[\"about_id\",\"project_id\"]','patch','historical-editor','person','2026-09-01')", String(parent.id), Number(current.rev) + i + 1, JSON.stringify(body));
  acme.run("update records set rev=? where id=?", Number(current.rev) + 2, String(parent.id));
  const beforeHistory = (await op("record.history", { ref: parent.key })).body.result;
  const undo = await op("record.undo", { ref: parent.key });
  assert.equal(undo.status, 400); assert.match(JSON.stringify(undo.body), /immutable/);
  assert.deepEqual((await op("record.history", { ref: parent.key })).body.result, beforeHistory);
  await visible();
  assert.equal((await op("record.archive", { ref: parent.key })).status, 200);
  assert.equal((await op("record.undo", { ref: parent.key })).status, 200, "archive undo restores without changing anchors");
  await visible();
  assert.equal((await op("record.archive", { ref: parent.key })).status, 200);
  assert.equal((await op("record.restore", { ref: parent.key })).status, 200);
  await visible();
  const unscoped = await make("entry", { title: "Historical-compatible absent anchors" });
  for (const set of [{ project_id: a.key }, { about_id: parent.key }])
    assert.equal((await op("record.patch", { ref: unscoped.key, set })).status, 400, "absent anchors are immutable too");
  assert.equal((await op("record.patch", { ref: parent.key, set: { project_id: a.key } })).status, 200, "same normalized anchor is a no-op");
  await visible();
  const correction = await make("entry", { title: "New attributed scope correction", about_id: b.key, detail: `Correction to ${String(parent.key)}` });
  assert.equal(correction.updated_by, "hermes:acme");
  assert.equal((correction.body as Json).project_id, b.id);
  const originalContext = (await op("project.context", { ref: a.key })).body.result as Json;
  assert.deepEqual(originalContext.scope_conflicts, []);
  assert.deepEqual((originalContext.log as Json[]).map(e => (e.record as Json).id).sort(), anchored.map(e => e.id).sort());
});
