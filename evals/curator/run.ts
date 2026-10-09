// Run the Curator's test set against a real model.  node evals/curator/run.ts [filter]
// Needs FIREWORKS_API_KEY. Costs cents. Not part of `npm test`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Companies } from "../../src/core/companies.ts";
import { Curator } from "../../src/curator/curator.ts";
import { base, chatCases, reviewCases } from "./cases.ts";

if (!process.env.FIREWORKS_API_KEY) { console.error("FIREWORKS_API_KEY is not set"); process.exit(2); }
const filter = process.argv[2] ?? "";
let pass = 0, fail = 0, cost = 0;
const report = (name: string, problem: string | null, usd: number, note = "") => {
  cost += usd; if (problem) fail++; else pass++;
  console.log(`${problem ? "FAIL" : "ok  "} ${name}${problem ? `\n       ${problem}` : ""}${note ? `\n       ${note}` : ""}`);
};

async function world<T>(fn: (curator: Curator, companies: Companies) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "rs-eval-"));
  const companies = new Companies(dir);
  const co = companies.create("acme", "Acme");
  base(co);
  const curator = new Curator(companies, { dataDir: dir, person: "Alex" });
  try { return await fn(curator, companies); } finally { await curator.close(); companies.close(); rmSync(dir, { recursive: true, force: true }); }
}

for (const c of reviewCases.filter((x) => x.name.includes(filter))) {
  await world(async (curator, companies) => {
    const co = companies.get("acme"); const cur = await curator.for("acme");
    await cur.review(); // sets the starting point
    c.writes(co);
    const r = await cur.review();
    report(`review: ${c.name}`, r?.status === "done" ? c.check(co) : `the review did not finish: ${r?.detail ?? "no run"}`, r?.cost_usd ?? 0, r?.detail ? `curator: ${r.detail.slice(0, 160)}` : "");
  });
}
for (const c of chatCases.filter((x) => x.name.includes(filter))) {
  await world(async (curator, companies) => {
    const co = companies.get("acme"); const cur = await curator.for("acme");
    c.setup?.(co);
    await cur.say(c.ask); await cur.waitForChat();
    const answer = (await cur.chat()).messages.filter((m) => m.who === "curator").at(-1)?.text ?? "";
    report(`chat: ${c.name}`, c.check(co, answer), await cur.spentToday(), `curator: ${answer.replace(/\s+/g, " ").slice(0, 200)}`);
  });
}
console.log(`\n${pass} passed, ${fail} failed, about $${cost.toFixed(4)} spent`);
process.exit(fail ? 1 : 0);
