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
  const server = createServer((req, res) => void handleApi(s.companies, req, res).then((mine) => { if (!mine) res.writeHead(404).end(); }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (key: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
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
  const rpc = (key: string, id: number | null, method: string, params: Json = {}) => call(key, "POST", "/mcp", { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params });
  const init = await rpc(keys.acme, 1, "initialize", { protocolVersion: "2025-06-18" });
  assert.equal(((init.body.result as Json).serverInfo as Json).name, "resultspace");
  assert.equal((await rpc(keys.acme, null, "notifications/initialized")).status, 202);
  const tools = ((await rpc(keys.acme, 2, "tools/list")).body.result as Json).tools as Json[];
  assert.ok(tools.some((x) => x.name === "record_search"));
  const made = (await rpc(keys.acme, 3, "tools/call", { name: "record_create", arguments: { kind: "entry", body: { title: "From MCP" } } })).body.result as Json;
  assert.equal(made.isError, false);
  const refused = (await rpc(keys.reader, 4, "tools/call", { name: "record_create", arguments: { kind: "entry", body: { title: "x" } } })).body.result as Json;
  assert.equal(refused.isError, true);
  assert.match(((refused.content as Json[])[0] as Json).text as string, /^forbidden/);
  assert.equal(((await rpc(keys.acme, 5, "nope")).body.error as Json).code, -32601);
  assert.equal((await call(null, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
});


test("API and MCP enforce assignment writes without trusting client-supplied context", async (t) => {
  const { acme, keys, call } = await serve(t);
  const a = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Count", owner: "hermes:acme" } });
  addAgent(acme, "else");
  const unrelated = issueKey(acme, "else");
  addAgent(acme, "boss", "admin");
  const boss = issueKey(acme, "boss");
  for (const [name, input] of [
    ["record.patch", { ref: a.key, set: { status: "done", result: "Finished" }, lifecycle: true, role: "admin" }],
    ["record.patch", { ref: a.key, set: { title: "Changed", owner: "else" } }],
    ["assignment.report", { ref: a.key, result: "Finished" }],
    ["record.archive", { ref: a.key }],
    ["record.restore", { ref: a.key }],
  ] as const) {
    const denied = await call(unrelated, "POST", `/v1/op/${name}`, input);
    assert.equal(denied.status, 403, name);
    assert.equal((denied.body.error as Json).code, "forbidden");
  }
  for (const [name, input] of [
    ["record_create", { kind: "work_order", body: { title: "X", owner: "hermes:acme", status: "done", _source: "alex" } }],
    ["record_patch", { ref: a.key, set: { verification: "verified", verified_by: "alex" } }],
  ] as const) {
    const denied = (await call(boss, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } })).body.result as Json;
    assert.equal(denied.isError, true);
    assert.match((denied.content as Json[])[0]!.text as string, /^forbidden/);
  }
  assert.equal((await call(keys.acme, "POST", "/v1/op/assignment.report", { ref: a.key, result: "Counted 12" })).status, 200);
  assert.equal((await call(boss, "POST", "/v1/op/assignment.verify", { ref: a.key, verdict: "verified" })).status, 403);
  assert.equal((await call(boss, "POST", "/v1/op/record.undo", { ref: a.key })).status, 403);
  assert.equal(rec(acme, admin, "record.get", { ref: a.key }).body.verification, undefined);
});

test("API and MCP reject unrelated assignment outcomes and preserve owner reports", async (t) => {
  const { acme, keys, call } = await serve(t);
  addAgent(acme, "else");
  const unrelated = issueKey(acme, "else");
  const a = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Count", owner: "hermes:acme" } });
  const outcome = rec(acme, admin, "record.create", { kind: "entry", body: { type: "outcome", title: "Checked", assignment_id: a.id } });
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Step", assignment_id: a.id } });
  for (const [name, input] of [
    ["record.create", { kind: "entry", body: { type: "outcome", title: "Counted", assignment_id: a.key } }],
    ["record.create", { kind: "entry", body: { type: "outcome", title: "Counted", work_order_id: a.id } }],
    ["record.patch", { ref: outcome.key, set: { title: "Changed", assignment_id: null } }],
    ["record.archive", { ref: outcome.key }],
    ["record.restore", { ref: outcome.key }],
    ["journal.log", { title: "Counted", about: a.key }],
    ["record.patch", { ref: task.key, set: { title: "Changed" }, result: "Counted" }],
  ] as const) {
    const denied = await call(unrelated, "POST", `/v1/op/${name}`, input, { "idempotency-key": `outcome-denied-${name}` });
    assert.equal(denied.status, 403, name);
    assert.equal((denied.body.error as Json).code, "forbidden");
  }
  const denied = (await call(unrelated, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: "record_create", arguments: { kind: "entry", body: { type: "outcome", title: "Counted", about_id: a.id } },
  } })).body.result as Json;
  assert.equal(denied.isError, true);
  assert.match((denied.content as Json[])[0]!.text as string, /^forbidden/);
  assert.equal(rec(acme, admin, "record.get", { ref: task.key }).rev, 1);
  assert.equal(acme.all("select * from ops").length, 0);
  assert.equal((await call(keys.acme, "POST", "/v1/op/assignment.report", { ref: a.key, result: "Counted 12" })).status, 200);
  const shown = (await call(keys.acme, "POST", "/v1/op/assignment.show", { ref: a.key })).body.result as Json;
  assert.equal(shown.result, "Counted 12");
  assert.equal((shown.outcomes as Json[]).length, 2);
});

test("API task relinking and undo preserve historical outcome authority", async (t) => {
  const { acme, keys, call } = await serve(t);
  addAgent(acme, "else");
  const otherKey = issueKey(acme, "else");
  const a = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "One", owner: "hermes:acme" } });
  const b = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Two", owner: "else" } });
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Step", assignment_id: a.id } });
  const outcome = rec(acme, admin, "journal.log", { title: "Checked", about: task.key });
  for (const key of [keys.acme, otherKey]) {
    assert.equal((await call(key, "POST", "/v1/op/record.patch", { ref: task.key, set: { work_order_id: b.key } })).status, 403);
  }
  rec(acme, admin, "record.patch", { ref: task.key, set: { assignment_id: b.id } });
  for (const key of [keys.acme, otherKey]) {
    assert.equal((await call(key, "POST", "/v1/op/record.undo", { ref: task.key })).status, 403);
    assert.equal((await call(key, "POST", "/v1/op/record.patch", { ref: outcome.key, set: { title: "Changed" } })).status, 403);
    if (key === keys.acme) assert.equal((await call(key, "POST", "/v1/op/record.archive", { ref: task.key })).status, 403);
  }
  rec(acme, admin, "record.patch", { ref: task.key, set: { assignment_id: null } });
  assert.equal((await call(otherKey, "POST", "/v1/op/record.patch", { ref: outcome.key, set: { assignment_id: b.key } })).status, 403);
  assert.equal(rec(acme, admin, "record.get", { ref: outcome.key }).rev, 1);
});

test("API and MCP protect session/action evidence and all assignment task edits", async (t) => {
  const { acme, keys, call } = await serve(t);
  addAgent(acme, "else");
  const otherKey = issueKey(acme, "else");
  const a = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Count", owner: "hermes:acme" } });
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Step", status: "todo", assignment_id: a.id } });
  for (const type of ["session", "action"]) {
    for (const link of [{ assignment_id: a.key }, { work_order_id: a.id }, { about_id: task.id }]) {
      assert.equal((await call(otherKey, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "Evidence", type, ...link } })).status, "about_id" in link ? 200 : 403);
    }
    const made = await call(keys.acme, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "Owner evidence", type, assignment_id: a.key } });
    assert.equal(made.status, 200);
    const evidence = made.body.result as Json;
    for (const [name, input] of [
      ["record.patch", { ref: evidence.key, set: { title: "Changed" } }],
      ["record.archive", { ref: evidence.key }], ["record.restore", { ref: evidence.key }],
    ] as const) assert.equal((await call(otherKey, "POST", `/v1/op/${name}`, input)).status, 403);
  }
  for (const set of [{ title: "Changed" }, { status: "done" }]) {
    const rpc = await call(otherKey, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "record_patch", arguments: { ref: task.key, set } } });
    assert.equal((rpc.body.result as Json).isError, true);
  }
  assert.equal(rec(acme, admin, "record.get", { ref: task.key }).rev, 1);
  const request = rec(acme, admin, "request.propose", { title: "Update the step", operation: "record.patch", input: { ref: task.key, set: { status: "done" } }, why: "Reviewed" });
  rec(acme, admin, "request.decide", { ref: request.key, approve: true });
  assert.equal(rec(acme, admin, "record.get", { ref: task.key }).body.status, "done");
  assert.equal((await call(otherKey, "POST", "/v1/op/record.undo", { ref: task.key })).status, 403);
  const shown = (await call(keys.acme, "POST", "/v1/op/assignment.show", { ref: a.key })).body.result as Json;
  assert.equal((shown.sessions as Json[]).length, 1);
  assert.equal((shown.actions as Json[]).length, 1);
});

test("API shared-task writes survive member evidence attachments and benign note fanout", async (t) => {
  const { acme, keys, call } = await serve(t);
  addAgent(acme, "else");
  const otherKey = issueKey(acme, "else");
  const a = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Own", owner: "hermes:acme" } });
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Shared", status: "todo" } });
  for (const type of ["outcome", "session", "action"]) {
    const made = await call(keys.acme, "POST", "/v1/op/record.create", { kind: "entry", body: { title: "Evidence", type, assignment_id: a.id, about_id: task.id } });
    assert.equal(made.status, 200);
    const id = (made.body.result as Json).id;
    assert.equal((await call(otherKey, "POST", "/v1/op/record.patch", { ref: task.id, set: { title: "Shared update", status: "done" } })).status, 200);
    assert.equal((await call(keys.acme, "POST", "/v1/op/record.patch", { ref: id, set: { assignment_id: null, about_id: null } })).status, 200);
    assert.equal((await call(otherKey, "POST", "/v1/op/record.patch", { ref: task.id, set: { title: "Detached update" } })).status, 200);
    assert.equal((await call(otherKey, "POST", "/v1/op/record.patch", { ref: id, set: { title: "Changed", authority: [], assignment_ids: [] } })).status, 403);
  }
  for (let n = 0; n < 130; n++) rec(acme, admin, "record.create", { kind: "entry", body: { title: `Note ${n}`, type: "note", about_id: task.id } });
  for (const name of ["record.archive", "record.restore", "record.undo"])
    assert.equal((await call(otherKey, "POST", `/v1/op/${name}`, { ref: task.id })).status, 200);
});
