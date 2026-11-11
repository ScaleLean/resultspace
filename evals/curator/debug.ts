// Run one review case and print what the Curator wrote.  scripts/with-model-key.sh node evals/curator/debug.ts "<case name part>"
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Companies } from "../../src/core/companies.ts";
import type { Rec } from "../../src/core/records.ts";
import { Curator } from "../../src/curator/curator.ts";
import { run } from "../../src/operations/index.ts";
import { base, reviewCases } from "./cases.ts";
const c = reviewCases.find((x) => x.name.includes(process.argv[2] ?? ""))!;
const dir = mkdtempSync(join(tmpdir(), "rs-dbg-")); const companies = new Companies(dir); const co = companies.create("acme", "Acme"); base(co);
const curator = new Curator(companies, { dataDir: dir }); const cur = await curator.for("acme"); await cur.review(); c.writes(co);
const r = await cur.review(); console.log(r);
for (const k of ["flag", "request"]) console.log(k, (run(co, { kind: "person", name: "alex", role: "admin" }, "record.list", { kind: k }) as Rec[]).map((x) => ({ key: x.key, ...x.body })));
console.log("check:", c.check(co)); await curator.close(); companies.close();
