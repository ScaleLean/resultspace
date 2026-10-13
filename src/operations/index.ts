// The one list of operations. The API, MCP, `rs` and the Curator's tools are all made from this list,
// and every call goes through run(): role check, input check, and for writes the repeat-safe ledger.
import { createHash } from "node:crypto";
import { Value } from "typebox/value";
import { roleRank, type Actor } from "../core/agents.ts";
import type { Company } from "../core/company.ts";
import { conflict, forbidden, invalid, notFound } from "../core/errors.ts";
import { assertWritable } from "../core/read-only.ts";
import { stable } from "../core/records.ts";
import { adminOperations } from "./admin.ts";
import { curatorMay, curatorOperations } from "./curator.ts";
import type { Operation } from "./define.ts";
import { recordOperations } from "./records.ts";
import { viewOperations } from "./views.ts";

export type { Ctx, Operation } from "./define.ts";

const base: Operation[] = [...recordOperations, ...viewOperations, ...adminOperations];
export const operations: Operation[] = [...base, ...curatorOperations];

const byName = new Map(operations.map((o) => [o.name, o]));
/**
 * Run one operation for an actor in a company. This is the only way in.
 * With `opId`, a write is repeat-safe: sending it again returns the first outcome and changes nothing.
 */
export function run(company: Company, actor: Actor, name: string, input: unknown, opId?: string): unknown {
  const o = byName.get(name);
  if (!o)
    throw notFound(
      `operation ${name}${/^(assignment|work|permission|action|request|skill)\.|^agent\.(presence|receipt)$/.test(name) ? " was removed in 0.4.0; upgrade clients to project.context and sourced knowledge/log writes" : ""}`,
    );
  if (roleRank(actor.role) < roleRank(o.role)) throw forbidden(`${name} needs the ${o.role} role`);
  if (o.write) assertWritable(company.readOnly);
  if (!Value.Check(o.input, input)) {
    const first = [...Value.Errors(o.input, input)][0];
    throw invalid(`${name}: ${first ? `${first.instancePath || "input"} ${first.message}` : "bad input"}`);
  }
  if (!o.write) return o.run({ company, actor }, input);
  if (actor.kind === "curator") curatorMay(company, name, input);
  return company.tx(() => {
    if (opId === undefined || o.ledger === false) return o.run({ company, actor }, input);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(opId)) throw invalid("bad op id");
    const requestHash = createHash("sha256")
      .update(`${name}\n${stable(input)}`)
      .digest("hex");
    const prior = company.one<{ actor: string; request_hash: string; outcome: string }>(
      "select actor, request_hash, outcome from ops where op_id = ?",
      opId,
    );
    if (prior) {
      if (prior.actor !== actor.name || prior.request_hash !== requestHash)
        throw conflict(`op id ${opId} was already used for a different request`);
      return JSON.parse(prior.outcome) as unknown;
    }
    const outcome = o.run({ company, actor, opId }, input);
    company.run(
      "insert into ops (op_id, actor, request_hash, outcome, at) values (?, ?, ?, ?, ?)",
      opId,
      actor.name,
      requestHash,
      JSON.stringify(outcome ?? null),
      new Date().toISOString(),
    );
    return outcome;
  });
}
