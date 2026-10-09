// The one list of operations. The API, MCP, `rs` and the Curator's tools are all made from this list,
// and every call goes through run(): role check, input check, and for writes the repeat-safe ledger.
import { createHash } from "node:crypto";
import { Value } from "typebox/value";
import { roleRank, type Actor } from "../core/agents.ts";
import type { Company } from "../core/company.ts";
import { conflict, forbidden, invalid, notFound } from "../core/errors.ts";
import { stable } from "../core/records.ts";
import { adminOperations } from "./admin.ts";
import { curatorMay, makeCuratorOperations } from "./curator.ts";
import type { Operation } from "./define.ts";
import { recordOperations } from "./records.ts";
import { skillOperations } from "./skills.ts";
import { viewOperations } from "./views.ts";
import { assignmentOperations, legacyWorkOperations } from "./assignments.ts";

export type { Ctx, Operation } from "./define.ts";

const base: Operation[] = [...recordOperations, ...assignmentOperations, ...legacyWorkOperations, ...viewOperations, ...skillOperations, ...adminOperations];
export const operations: Operation[] = [...base, ...makeCuratorOperations((name) => byName.get(name))];

const byName = new Map(operations.map((o) => [o.name, o]));
// Who still calls an old name (work.*), once per process: the server log says when an alias can go.
const oldNameCallers = new Set<string>();

/**
 * Run one operation for an actor in a company. This is the only way in.
 * With `opId`, a write is repeat-safe: sending it again returns the first outcome and changes nothing.
 */
export function run(company: Company, actor: Actor, name: string, input: unknown, opId?: string): unknown {
  const o = byName.get(name);
  if (!o) throw notFound(`operation ${name}`);
  if (o.replacedBy && !oldNameCallers.has(`${company.slug} ${actor.name} ${name}`)) {
    oldNameCallers.add(`${company.slug} ${actor.name} ${name}`);
    console.warn(`resultspace: old operation name ${name} (now ${o.replacedBy}) called by ${actor.name} in ${company.slug}`);
  }
  if (roleRank(actor.role) < roleRank(o.role)) throw forbidden(`${name} needs the ${o.role} role`);
  if (!Value.Check(o.input, input)) {
    const first = [...Value.Errors(o.input, input)][0];
    throw invalid(`${name}: ${first ? `${first.instancePath || "input"} ${first.message}` : "bad input"}`);
  }
  if (!o.write) return o.run({ company, actor }, input);
  if (actor.kind === "curator") curatorMay(company, name, input);
  return company.tx(() => {
    if (opId === undefined) return o.run({ company, actor }, input);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(opId)) throw invalid("bad op id");
    const requestHash = createHash("sha256").update(`${name}\n${stable(input)}`).digest("hex");
    const prior = company.one<{ actor: string; request_hash: string; outcome: string }>("select actor, request_hash, outcome from ops where op_id = ?", opId);
    if (prior) {
      if (prior.actor !== actor.name || prior.request_hash !== requestHash) throw conflict(`op id ${opId} was already used for a different request`);
      return JSON.parse(prior.outcome) as unknown;
    }
    const outcome = o.run({ company, actor, opId }, input);
    company.run("insert into ops (op_id, actor, request_hash, outcome, at) values (?, ?, ?, ?, ?)", opId, actor.name, requestHash, JSON.stringify(outcome ?? null), new Date().toISOString());
    return outcome;
  });
}
