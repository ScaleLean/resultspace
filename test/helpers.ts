import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { Actor } from "../src/core/agents.ts";
import { Companies } from "../src/core/companies.ts";
import type { Rec } from "../src/core/records.ts";
import { run } from "../src/operations/index.ts";

/** A data directory with two companies, removed when the test ends. */
export function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "rs-test-"));
  const companies = new Companies(dir);
  const acme = companies.create("acme", "Acme");
  const other = companies.create("other-co", "Other Co");
  t.after(() => { companies.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, companies, acme, other };
}

export const admin: Actor = { kind: "person", name: "alex", role: "admin" };
export const member: Actor = { kind: "agent", name: "hermes:acme", role: "member" };
export const viewer: Actor = { kind: "agent", name: "reader", role: "viewer" };

export const rec = (...args: Parameters<typeof run>): Rec => run(...args) as Rec;
