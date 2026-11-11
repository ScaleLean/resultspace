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


test("API and MCP allow shared assignment writes and preserve authenticated provenance", async (t) => {
  const { acme, keys, call } = await serve(t);
  addAgent(acme, "colleague");
  const colleague = issueKey(acme, "colleague");
  const a = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Shared", owner: "hermes:acme" } });
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Step", assignment_id: a.id } });
  const entry = rec(acme, admin, "record.create", { kind: "entry", body: { title: "Report", type: "outcome", assignment_id: a.id, about_id: task.id } });
  for (const ref of [a.key, task.key, entry.key]) {
    const edit = await call(colleague, "POST", "/v1/op/record.patch", { ref, set: { title: "Shared edit", metadata: { actor: "client label" } }, role: "admin", actor: "invented", company: "other-co" });
    assert.equal(edit.status, 200);
    const result = edit.body.result as Json;
    assert.equal(result.updated_by, "colleague");
    assert.equal((await call(colleague, "POST", "/v1/op/record.archive", { ref })).status, 200);
    assert.equal((await call(keys.acme, "POST", "/v1/op/record.restore", { ref })).status, 200);
  }
  const rpc = async (key: string, name: string, input: Json) => (await call(key, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } })).body.result as Json;
  for (const name of ["assignment_start", "assignment_report"]) {
    assert.equal((await rpc(colleague, name, { ref: a.key, ...(name === "assignment_report" ? { result: "Reported" } : {}) })).isError, false);
  }
  assert.equal(rec(acme, admin, "record.get", { ref: a.key }).body.reported_by, "colleague");
  assert.equal((await rpc(colleague, "assignment_review", { ref: a.key, note: "Review observation" })).isError, false);
  for (const field of ["reported_by", "verification", "verified_by"]) {
    const refused = await rpc(colleague, "record_patch", { ref: a.key, set: { [field]: "forged" } });
    assert.equal(refused.isError, true);
    assert.match((refused.content as Json[])[0]!.text as string, /^forbidden/);
  }
  const input = { ref: task.key, set: { title: "Repeat-safe" } };
  const headers = { "idempotency-key": "shared-write-0001" };
  const first = await call(colleague, "POST", "/v1/op/record.patch", input, headers);
  assert.deepEqual(await call(colleague, "POST", "/v1/op/record.patch", input, headers), first);
  assert.equal((await call(keys.acme, "POST", "/v1/op/record.patch", input, headers)).status, 409);
  assert.equal((await call(colleague, "POST", "/v1/op/record.patch", { ...input, base_rev: 1 })).status, 409);
  for (const key of [null, keys.reader, keys.other]) {
    const expected = key === null ? 401 : key === keys.reader ? 403 : 404;
    assert.equal((await call(key, "POST", "/v1/op/assignment.review", { ref: a.id, note: "Denied" })).status, expected);
  }
  assert.equal((await call(keys.other, "POST", "/v1/op/record.create", { kind: "task", body: { title: "Foreign", assignment_id: a.id } })).status, 400);
});

test("agreeing with a suggestion never invokes its proposed operation, through the API", async (t) => {
  const { acme, keys, call } = await serve(t);
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Step" } });
  for (const operation of ["record.patch", "record.archive", "kind.define"]) {
    const input = operation === "record.patch" ? { ref: task.key, set: { title: "Suggested" } } : operation === "record.archive" ? { ref: task.key } : { kind: "suggested", prefix: "SUG" };
    const req = rec(acme, admin, "request.propose", { title: "Suggestion", operation, input, why: "Review" });
    const before = rec(acme, admin, "record.get", { ref: task.key });
    const result = await call(keys.acme, "POST", "/v1/op/request.decide", { ref: req.key, approve: true }, { "idempotency-key": `suggestion-${req.key}` });
    assert.equal(result.status, 200);
    assert.deepEqual(rec(acme, admin, "record.get", { ref: task.key }), before);
    assert.equal(acme.one("select * from kinds where kind = 'suggested'"), undefined);
    assert.equal((result.body.result as Json).updated_by, "hermes:acme");
  }
});
