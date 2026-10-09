#!/usr/bin/env node
// Operator commands, run on the machine that holds the data directory. They open company files directly,
// so stop the server first or use the API (`rs agents ...`) while it runs.
//   node src/admin.ts company create SLUG "Name"
//   node src/admin.ts company list
//   node src/admin.ts agent add SLUG NAME [viewer|member|admin]
//   node src/admin.ts agent key SLUG NAME --out FILE     (the key is written 0600, never printed)
//   node src/admin.ts person add NAME EMAIL              (the password is read from standard input)
//   node src/admin.ts person reset EMAIL                 (prints a one-time link, good for 30 minutes)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { addAgent, issueKey, listAgents, ROLES, type Role } from "./core/agents.ts";
import { Companies } from "./core/companies.ts";
import { People } from "./core/people.ts";

const [group, verb, ...rest] = process.argv.slice(2);
const dir = process.env.DATA_DIR ?? join(import.meta.dirname, "..", "data");
const companies = new Companies(dir);
const need = (v: string | undefined, what: string): string => { if (!v) { console.error(`missing ${what}`); process.exit(2); } return v; };
try {
  if (group === "company" && verb === "create") { const co = companies.create(need(rest[0], "slug"), need(rest[1], "name")); console.log(`created ${co.slug}`); }
  else if (group === "company" && verb === "list") for (const s of companies.slugs()) console.log(`${s}\t${companies.get(s).name}`);
  else if (group === "agent" && verb === "add") {
    const role = (rest[2] ?? "member") as Role;
    if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(", ")}`);
    console.log(`added ${addAgent(companies.get(need(rest[0], "slug")), need(rest[1], "agent name"), role).name}`);
  } else if (group === "agent" && verb === "list") for (const a of listAgents(companies.get(need(rest[0], "slug")))) console.log(`${a.name}\t${a.role}\t${a.active ? "on" : "off"}`);
  else if (group === "agent" && verb === "key") {
    const out = rest[rest.indexOf("--out") + 1];
    if (!rest.includes("--out") || !out) throw new Error("say where to write the key: --out FILE");
    writeFileSync(out, `${issueKey(companies.get(need(rest[0], "slug")), need(rest[1], "agent name"))}\n`, { mode: 0o600, flag: "wx" });
    console.log(`key written to ${out}`);
  } else if (group === "person" && (verb === "add" || verb === "reset")) {
    const people = People.open(dir);
    try {
      if (verb === "add") {
        const password = (await new Promise<string>((ok) => { let s = ""; process.stdin.on("data", (d) => (s += String(d))).on("end", () => ok(s)); })).replace(/\r?\n$/, "");
        await people.add(need(rest[0], "name"), need(rest[1], "email"), { password });
        console.log(`added ${rest[0]}`);
      } else console.log(`${(process.env.RS_PUBLIC_URL ?? "").replace(/\/+$/, "")}/reset#${people.makeReset(need(rest[0], "email"))}`);
    } finally { people.close(); }
  } else { console.error("usage: admin.ts company create|list ... | agent add|list|key ... | person add|reset ..."); process.exitCode = 2; }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  companies.close();
}
