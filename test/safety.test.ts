// The rules that must never break: companies stay apart, nothing is deleted, history cannot be rewritten,
// a repeated write applies once, and a role limits what a caller may do.
import assert from "node:assert/strict";
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addAgent, issueKey, revokeKeys, setAgentActive } from "../src/core/agents.ts";
import { Company } from "../src/core/company.ts";
import { RsError } from "../src/core/errors.ts";
import type { Hit, Revision } from "../src/core/records.ts";
import { operations, run } from "../src/operations/index.ts";
import { admin, member, rec, setup, viewer } from "./helpers.ts";

const code = (c: string) => (e: unknown) => e instanceof RsError && e.code === c;

test("isolation: one company's records cannot be read, found or referenced from another", (t) => {
  const { acme, other } = setup(t);
  const secret = rec(acme, member, "record.create", { kind: "knowledge", body: { title: "Acme margin", body: "confidential-figure 41%" } });
  assert.throws(() => run(other, member, "record.get", { ref: secret.id }), code("not_found"));
  assert.throws(() => run(other, member, "record.get", { ref: secret.key }), code("not_found"));
  assert.deepEqual(run(other, member, "record.search", { q: "confidential-figure" }) as Hit[], []);
  assert.deepEqual(run(other, member, "changes.since", { since: 0 }), []);
  assert.throws(() => run(other, member, "record.create", { kind: "project", body: { title: "P", goal_id: secret.id } }), code("invalid"));
  // An undeclared *_id that names another company's record is kept as plain text and makes no link.
  const n = rec(other, member, "record.create", { kind: "entry", body: { title: "N", source_id: secret.id } });
  assert.deepEqual(run(other, member, "record.links", { ref: n.key }), { out: [], in: [] });
});

test("isolation: an agent key works for its own company only", (t) => {
  const { companies, acme, other } = setup(t);
  addAgent(acme, "hermes:acme");
  const key = issueKey(acme, "hermes:acme");
  const hit = companies.authenticate(key);
  assert.equal(hit?.company.slug, "acme");
  assert.deepEqual(hit?.actor, { kind: "agent", name: "hermes:acme", role: "member" });
  // The same secret under another company's slug is nobody, even if that company has an agent of the same name.
  addAgent(other, "hermes:acme");
  assert.equal(companies.authenticate(key.replace("rsk_acme_", "rsk_other-co_")), undefined);
  assert.equal(companies.authenticate("rsk_nope_" + "x".repeat(32)), undefined);
  assert.equal(companies.authenticate("garbage"), undefined);
  // Only the hash is stored.
  assert.equal(acme.all("select * from agent_keys where key_hash = ?", key).length, 0);
  revokeKeys(acme, "hermes:acme");
  assert.equal(companies.authenticate(key), undefined);
  const key2 = issueKey(acme, "hermes:acme");
  assert.ok(companies.authenticate(key2));
  setAgentActive(acme, "hermes:acme", false);
  assert.equal(companies.authenticate(key2), undefined);
});

test("isolation: a company file refuses to open under another company's name", (t) => {
  const { dir, acme } = setup(t);
  acme.run("pragma wal_checkpoint(truncate)"); // so the copy below is the whole file
  copyFileSync(join(dir, "acme.sqlite"), join(dir, "stolen.sqlite"));
  assert.throws(() => Company.open(dir, "stolen"), /belongs to acme/);
  assert.throws(() => Company.open(dir, "missing"), code("not_found"));
  assert.throws(() => Company.open(dir, "../acme"), code("invalid"));
});

test("no delete: the file itself refuses to delete records or rewrite history", (t) => {
  const { acme } = setup(t);
  const r = rec(acme, member, "record.create", { kind: "entry", body: { title: "Keep me" } });
  run(acme, member, "record.patch", { ref: r.key, set: { title: "Keep me too" } }, "op-00000001");
  assert.throws(() => acme.run("delete from records where id = ?", r.id), /never deleted/);
  assert.throws(() => acme.run("delete from revisions"), /append-only/);
  assert.throws(() => acme.run("update revisions set body = '{}'"), /append-only/);
  assert.throws(() => acme.run("delete from ops"), /append-only/);
  assert.throws(() => acme.run("update ops set outcome = '{}'"), /append-only/);
  addAgent(acme, "a1");
  issueKey(acme, "a1");
  assert.throws(() => acme.run("delete from agent_keys"), /revoked, not deleted/);
  assert.ok(!operations.some((o) => /delete|remove|purge/.test(o.name)), "no operation deletes");
  // Archive hides a record from lists and search but keeps it and its history.
  run(acme, member, "record.archive", { ref: r.key });
  assert.deepEqual(run(acme, member, "record.list", { kind: "entry" }), []);
  assert.equal(rec(acme, member, "record.get", { ref: r.key }).archived, true);
  assert.equal((run(acme, member, "record.history", { ref: r.key }) as Revision[]).length, 3);
  assert.equal(rec(acme, member, "record.restore", { ref: r.key }).archived, false);
});

test("repeat-safe: the same op id applies once and returns the first outcome", (t) => {
  const { acme } = setup(t);
  const input = { kind: "entry", body: { title: "Once" } };
  const a = rec(acme, member, "record.create", input, "op-create-0001");
  const b = rec(acme, member, "record.create", input, "op-create-0001");
  assert.deepEqual(b, a);
  assert.equal((run(acme, member, "record.list", { kind: "entry" }) as unknown[]).length, 1);
  assert.equal((run(acme, member, "record.history", { ref: a.key }) as Revision[])[0]?.op_id, "op-create-0001");
  // The same id for a different request, or from a different actor, is refused.
  assert.throws(() => run(acme, member, "record.create", { kind: "entry", body: { title: "Twice" } }, "op-create-0001"), code("conflict"));
  assert.throws(() => run(acme, admin, "record.create", input, "op-create-0001"), code("conflict"));
  // A write that fails leaves nothing behind, so the same id can be sent again once the input is fixed... as a new request.
  assert.throws(() => run(acme, member, "record.create", { kind: "task", body: { title: "T", status: "bogus" } }, "op-create-0002"), code("invalid"));
  assert.equal(acme.all("select * from ops where op_id = 'op-create-0002'").length, 0);
  assert.equal(acme.all("select * from records where kind = 'task'").length, 0);
});

test("roles: a viewer reads, a member writes records, an admin defines kinds", (t) => {
  const { acme } = setup(t);
  assert.throws(() => run(acme, viewer, "record.create", { kind: "entry", body: { title: "x" } }), code("forbidden"));
  assert.throws(() => run(acme, member, "kind.define", { kind: "formula", prefix: "FRM" }), code("forbidden"));
  assert.deepEqual(run(acme, viewer, "record.list", {}), []);
  assert.throws(() => run(acme, admin, "record.nope", {}), code("not_found"));
  assert.throws(() => run(acme, member, "record.create", { kind: "entry" }), code("invalid"));
  assert.throws(() => run(acme, member, "record.create", { kind: "entry", body: "text" }), code("invalid"));
});

test("code rules: no `any` in the source", () => {
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []));
  const bad = files("src").flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, n: i + 1, line })))
    .filter((x) => /(:\s*any\b|\bas any\b|<any>|\bany\[\])/.test(x.line.replace(/\/\/.*$/, "")));
  assert.deepEqual(bad.map((x) => `${x.f}:${x.n}`), []);
});
