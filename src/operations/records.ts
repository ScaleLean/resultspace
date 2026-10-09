// Operations on records of any kind.
import { Type } from "typebox";
import { listAgents } from "../core/agents.ts";
import type { Company } from "../core/company.ts";
import { invalid, notFound } from "../core/errors.ts";
import { defineKind, listKinds } from "../core/kinds.ts";
import * as records from "../core/records.ts";
import { canonicalKind } from "../core/schema.ts";
import { Body, Limit, meta, op, Ref, Result, who, Why, type Operation } from "./define.ts";

/** An assignment must name the agent who is to do it, and that agent must exist and be on. */
export function checkOwner(co: Company, body: records.Body): void {
  const owner = body.owner;
  if (typeof owner !== "string" || !owner) throw invalid("an assignment needs an owner (an agent's name)");
  if (owner !== "curator" && !listAgents(co).some((a) => a.name === owner && a.active)) throw invalid(`no active agent ${owner} in this company`);
}

export const recordOperations: Operation[] = [
  op({
    name: "record.create", summary: "Create a record of a kind", role: "member", write: true,
    input: Type.Object({ kind: Type.String(), body: Body, why: Why, result: Result }),
    run: (ctx, i) => {
      const kind = canonicalKind(i.kind); // `work_order` (the old name) makes an assignment
      const body = kind === "assignment" ? { status: "queued", ...i.body } : kind === "entry" ? { type: "note", ...i.body } : i.body;
      if (kind === "assignment") checkOwner(ctx.company, body);
      const r = records.create(ctx.company, who(ctx), kind, body, meta(ctx, i.why));
      if (i.result && kind !== "entry") records.logEntry(ctx.company, who(ctx), "outcome", i.result, r, meta(ctx));
      return r;
    },
  }),
  op({
    name: "record.patch", summary: "Set fields on a record (null removes a field)", role: "member", write: true,
    input: Type.Object({ ref: Ref, set: Body, base_rev: Type.Optional(Type.Integer({ minimum: 1 })), why: Why, result: Result }),
    run: (ctx, i) => {
      const r = records.patch(ctx.company, who(ctx), i.ref, i.set, { ...meta(ctx, i.why), baseRev: i.base_rev });
      if (r.kind === "assignment" && "owner" in i.set) checkOwner(ctx.company, r.body);
      if (i.result) records.logEntry(ctx.company, who(ctx), "outcome", i.result, r, meta(ctx));
      return r;
    },
  }),
  op({
    name: "record.archive", summary: "Archive a record (nothing is ever deleted)", role: "member", write: true,
    input: Type.Object({ ref: Ref, why: Why }),
    run: (ctx, i) => records.setArchived(ctx.company, who(ctx), i.ref, true, meta(ctx, i.why)),
  }),
  op({
    name: "record.restore", summary: "Bring an archived record back", role: "member", write: true,
    input: Type.Object({ ref: Ref, why: Why }),
    run: (ctx, i) => records.setArchived(ctx.company, who(ctx), i.ref, false, meta(ctx, i.why)),
  }),
  op({
    name: "record.get", summary: "Read one record", role: "viewer", write: false,
    input: Type.Object({ ref: Ref }),
    run: (ctx, i) => {
      const r = records.get(ctx.company, i.ref);
      if (!r) throw notFound(`record ${i.ref}`);
      return r;
    },
  }),
  op({
    name: "record.context", summary: "One record with what it points at, what points at it, and its last changes", role: "viewer", write: false,
    input: Type.Object({ ref: Ref }),
    run: (ctx, i) => {
      const r = records.need(ctx.company, i.ref);
      return { record: r, links: records.links(ctx.company, r.id), history: records.history(ctx.company, r.id).slice(-10).map(({ body: _body, ...v }) => v) };
    },
  }),
  op({
    name: "record.list", summary: "List records, newest first", role: "viewer", write: false,
    input: Type.Object({
      kind: Type.Optional(Type.String()), status: Type.Optional(Type.String()),
      where: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), { description: "Body fields that must equal these values" })),
      since: Type.Optional(Type.String({ description: "Only records changed since this ISO time" })),
      archived: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("all")])), limit: Limit(1000),
    }),
    run: (ctx, i) => records.list(ctx.company, i),
  }),
  op({
    name: "record.search", summary: "Full-text search in this company's records, best match first, with a snippet", role: "viewer", write: false,
    input: Type.Object({ q: Type.String({ minLength: 1, maxLength: 400 }), kind: Type.Optional(Type.String()), limit: Limit(200) }),
    run: (ctx, i) => records.search(ctx.company, i.q, i),
  }),
  op({
    name: "record.history", summary: "Every version of a record, oldest first", role: "viewer", write: false,
    input: Type.Object({ ref: Ref }),
    run: (ctx, i) => records.history(ctx.company, i.ref),
  }),
  op({
    name: "record.links", summary: "What a record points at, and what points at it", role: "viewer", write: false,
    input: Type.Object({ ref: Ref }),
    run: (ctx, i) => records.links(ctx.company, i.ref),
  }),
  op({
    name: "changes.since", summary: "The company's change feed after a sequence number", role: "viewer", write: false,
    input: Type.Object({ since: Type.Integer({ minimum: 0 }), limit: Limit(5000) }),
    run: (ctx, i) => records.changes(ctx.company, i.since, i.limit),
  }),
  op({
    name: "kind.list", summary: "The record kinds of this company", role: "viewer", write: false,
    input: Type.Object({}),
    run: (ctx) => listKinds(ctx.company),
  }),
  op({
    name: "kind.define", summary: "Add a record kind, or change its statuses and reference fields", role: "admin", write: true,
    input: Type.Object({
      kind: Type.String(), prefix: Type.String(), title_field: Type.Optional(Type.String()),
      statuses: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
      refs: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
    }),
    run: (ctx, i) => defineKind(ctx.company, i),
  }),
];
