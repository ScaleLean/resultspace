import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cookieOf, hashPassword, People, RateLimit, verifyPassword } from "../src/core/people.ts";

test("sign-in: sessions, password change, reset, and the audit log", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rs-people-"));
  const people = People.open(dir);
  t.after(() => { people.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(people.any(), false);
  await assert.rejects(people.add("alex", "alex@example.com", { password: "short" }), /at least 12/);
  await people.add("alex", "Alex@Example.com", { password: "correct horse battery" });
  assert.equal(await people.signIn("alex@example.com", "wrong password!!", "1.1.1.1"), null);
  assert.equal(await people.signIn("nobody@example.com", "correct horse battery", "1.1.1.1"), null);
  const a = (await people.signIn("ALEX@example.com", "correct horse battery", "1.1.1.1"))!;
  const b = (await people.signIn("alex@example.com", "correct horse battery", "2.2.2.2"))!;
  assert.deepEqual(people.session(a), { name: "alex", email: "alex@example.com" });
  assert.deepEqual(people.actor(people.session(a)!), { kind: "person", name: "alex", role: "admin" });
  assert.equal(people.session("nope"), null);

  // Changing the password ends the other session and keeps this one.
  assert.deepEqual(await people.changePassword(a, "nope nope nope", "a brand new password", "a brand new password", "1.1.1.1"), { ok: false, error: "The current password is not right." });
  assert.deepEqual(await people.changePassword(a, "correct horse battery", "a brand new password", "a brand new password", "1.1.1.1"), { ok: true });
  assert.ok(people.session(a));
  assert.equal(people.session(b), null);

  // A reset link works once and ends every session.
  const reset = people.makeReset("alex@example.com");
  assert.equal((await people.useReset("rspw_bogus", "yet another password", "yet another password", "3.3.3.3")).ok, false);
  assert.deepEqual(await people.useReset(reset, "yet another password", "yet another password", "3.3.3.3"), { ok: true });
  assert.equal((await people.useReset(reset, "one more password!!", "one more password!!", "3.3.3.3")).ok, false);
  assert.equal(people.session(a), null);
  const c = (await people.signIn("alex@example.com", "yet another password", "1.1.1.1"))!;
  people.signOut(c, "1.1.1.1");
  assert.equal(people.session(c), null);
});

test("sign-in: an imported hash still works, and guessing is slowed", async () => {
  const hash = await hashPassword("the old password 1");
  assert.match(hash, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword("the old password 1", hash), true);
  assert.equal(await verifyPassword("the old password 2", hash), false);
  assert.equal(await verifyPassword("anything", undefined), false);
  const limit = new RateLimit();
  for (let i = 0; i < 10; i++) limit.fail("9.9.9.9", "alex@example.com");
  assert.equal(limit.blocked("9.9.9.9", "ALEX@example.com"), true);
  assert.equal(limit.blocked("8.8.8.8", "alex@example.com"), false);
  assert.equal(cookieOf("a=1; rs_session=abc; b=2"), "abc");
  assert.equal(cookieOf(undefined), null);
});
