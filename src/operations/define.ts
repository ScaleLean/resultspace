// What an operation is, and the input shapes several operations share.
import { Type, type Static, type TSchema } from "typebox";
import type { Actor, Role } from "../core/agents.ts";
import type { Company } from "../core/company.ts";
import type { Who, WriteMeta } from "../core/records.ts";

export type Ctx = { company: Company; actor: Actor; opId?: string | undefined };

export type Operation = {
  /** Dotted name: `record.create`. Surfaces derive their route, tool and command names from it. */
  name: string;
  summary: string;
  /** The lowest role that may call it. */
  role: Role;
  /** A write is run in one transaction and recorded in the op ledger when the caller gives an op id. */
  write: boolean;
  input: TSchema;
  run: (ctx: Ctx, input: unknown) => unknown;
  /** Set on an old name kept as an alias: the operation that replaces it. Aliases are left out of tool lists. */
  replacedBy?: string;
};

export function op<S extends TSchema>(def: Omit<Operation, "input" | "run"> & { input: S; run: (ctx: Ctx, input: Static<S>) => unknown }): Operation {
  return { ...def, run: (ctx, input) => def.run(ctx, input as Static<S>) };
}

export const Ref = Type.String({ minLength: 1, maxLength: 80, description: "A record key (TSK-0007) or id" });
export const Body = Type.Record(Type.String(), Type.Unknown());
export const Why = Type.Optional(Type.String({ maxLength: 500, description: "Why this change was made" }));
export const Result = Type.Optional(Type.String({ minLength: 1, maxLength: 300, description: "The outcome, result first: what changed or is now true. Recorded as a result." }));
export const Limit = (max: number) => Type.Optional(Type.Integer({ minimum: 1, maximum: max }));

export const who = (ctx: Ctx): Who => ({ name: ctx.actor.name, kind: ctx.actor.kind });
export const meta = (ctx: Ctx, why?: string | undefined): WriteMeta => ({ why, opId: ctx.opId });

/** "24h", "7d", "30m" or an ISO time -> an ISO time. */
export function sinceTime(s: string | undefined, fallbackHours: number): string {
  const m = /^(\d+)\s*([mhdw])$/.exec(s ?? "");
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  if (m) return new Date(Date.now() - Number(m[1]) * unit[m[2] as keyof typeof unit]).toISOString();
  const t = s ? Date.parse(s) : NaN;
  return new Date(Number.isNaN(t) ? Date.now() - fallbackHours * 3_600_000 : t).toISOString();
}
