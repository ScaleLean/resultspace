import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { isLoopback, isTailnet, parseTrust, trusted } from "../src/core/trust.ts";
import { startServer } from "../src/server.ts";

test("trust: loopback and tailnet addresses are told apart from the socket address", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("100.100.237.53"), false);
  assert.equal(isTailnet("100.100.237.53"), true);
  assert.equal(isTailnet("100.64.0.1"), true);
  assert.equal(isTailnet("100.128.0.1"), false, "just past the CGNAT range");
  assert.equal(isTailnet("fd7a:115c:a1e0::923a:ed36"), true);
  assert.equal(isTailnet("172.19.0.3"), false, "a container network address is never trusted");
  assert.equal(trusted("100.100.237.53", "loopback"), false);
  assert.equal(trusted("100.100.237.53", "tailnet"), true);
  assert.equal(trusted("127.0.0.1", "none"), false);
  assert.equal(trusted(undefined, "tailnet"), false);
  assert.equal(parseTrust(undefined), "loopback");
  assert.throws(() => parseTrust("everyone"));
});

async function serve(t: TestContext, trust: "loopback" | "none") {
  const dir = mkdtempSync(join(tmpdir(), "rs-trust-"));
  const s = await startServer({ dataDir: dir, port: 0, host: "127.0.0.1", trust });
  t.after(async () => { await s.close(); rmSync(dir, { recursive: true, force: true }); });
  return { s, get: (p: string) => fetch(`http://127.0.0.1:${s.port}${p}`, { redirect: "manual" }) };
}

test("trust: from this machine the browser is the owner; with trust off it must sign in", async (t) => {
  const open = await serve(t, "loopback");
  const r = await open.get("/");
  // No company yet: set-up, not sign-in. (The web app answers; its exact page is the web tests' business.)
  assert.notEqual(r.headers.get("location"), "/login");
  open.s.companies.create("acme", "Acme");
  const home = await open.get("/c/acme");
  assert.notEqual(home.status, 303, "no redirect to sign-in from loopback");
  const closed = await serve(t, "none");
  closed.s.companies.create("acme", "Acme");
  const r2 = await closed.get("/c/acme");
  assert.equal(r2.status, 303);
  assert.equal(r2.headers.get("location"), "/setup", "no account yet, so set-up first");
});
