import { Type } from "typebox";
import type { Company } from "../core/company.ts";
import { forbidden, invalid } from "../core/errors.ts";
import * as records from "../core/records.ts";
import { evidence } from "../core/context.ts";
import { upkeepFindings } from "../curator/scan.ts";
import { meta, op, Ref, who, type Operation } from "./define.ts";

export function curatorMay(_company: Company, name: string, _input: unknown): void {
  if (!["curator.flag", "curator.briefing", "curator.review"].includes(name))
    throw forbidden("Curator may flag and suggest; it never edits claims or dispatches work");
}
export function reviewEvidence(co: Company) {
  return co.tx(() => {
    const findings = upkeepFindings(co, Number.MAX_SAFE_INTEGER);
    const prior = new Set(
      co
        .all<{
          signature: string;
        }>("select json_extract(v.body, '$.signature') as signature from records r join revisions v on v.record_id=r.id and v.rev=1 where r.kind='flag' and v.actor_kind='curator' and v.actor='curator'")
        .map((x) => x.signature),
    );
    const flags = findings
      .filter((f) => !prior.has(f.signature))
      .slice(0, 100)
      .map((f) =>
        records.create(co, { name: "curator", kind: "curator", role: "member" }, "flag", {
          title: f.title,
          status: "open",
          flag_type: f.type,
          about_id: f.evidence[0]!.record.id,
          evidence_ids: f.evidence.map((e) => e.record.id),
          evidence: f.evidence,
          detail: f.detail,
          signature: f.signature,
          suggestion: "Review the cited evidence and record any correction explicitly with its source.",
        }),
      );
    return { findings, created: flags };
  });
}
export const curatorOperations: Operation[] = [
  op({
    name: "curator.scan",
    summary: "Review contradiction, unsupported and stale candidates with evidence",
    role: "viewer",
    write: false,
    input: Type.Object({}),
    run: (ctx) => upkeepFindings(ctx.company),
  }),
  op({
    name: "curator.review",
    summary: "Record evidence findings without changing claims",
    role: "member",
    write: true,
    input: Type.Object({}),
    run: (ctx) => reviewEvidence(ctx.company),
  }),
  op({
    name: "curator.flag",
    summary: "Record a sourced finding and a suggested correction; never execute it",
    role: "member",
    write: true,
    input: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 300 }),
      detail: Type.String({ minLength: 1, maxLength: 8000 }),
      evidence: Type.Array(Ref, { minItems: 1, maxItems: 20 }),
      suggestion: Type.Optional(Type.String({ maxLength: 8000 })),
    }),
    run: (ctx, i) => {
      const rs = i.evidence.map((ref) => records.need(ctx.company, ref));
      return records.create(
        ctx.company,
        who(ctx),
        "flag",
        {
          title: i.title,
          detail: i.detail,
          status: "open",
          about_id: rs[0]!.id,
          evidence_ids: rs.map((r) => r.id),
          evidence: rs.map((r) => evidence(ctx.company, r)),
          suggestion: i.suggestion ?? "",
        },
        meta(ctx),
      );
    },
  }),
  op({
    name: "curator.briefing",
    summary: "Record a review briefing",
    role: "member",
    write: true,
    input: Type.Object({ title: Type.String({ minLength: 1, maxLength: 300 }), text: Type.String({ minLength: 1, maxLength: 8000 }) }),
    run: (ctx, i) => records.create(ctx.company, who(ctx), "briefing", i, meta(ctx)),
  }),
  op({
    name: "record.undo",
    summary: "Undo the latest record change, keeping its history",
    role: "member",
    write: true,
    input: Type.Object({ ref: Ref, rev: Type.Optional(Type.Integer({ minimum: 2 })) }),
    run: (ctx, i) => {
      const r = records.need(ctx.company, i.ref);
      if (records.isLegacy(ctx.company, r.id)) throw forbidden("Legacy archive is read-only");
      const hist = records.history(ctx.company, r.id);
      const last = hist.at(-1),
        before = hist.at(-2);
      if (!last || !before) throw invalid("No prior revision");
      if (i.rev !== undefined && i.rev !== r.rev) throw invalid("Record changed again; read it first");
      if (last.archived !== before.archived)
        return records.setArchived(ctx.company, who(ctx), r.id, before.archived, meta(ctx, `undo revision ${r.rev}`));
      const set = Object.fromEntries(last.changed.map((k) => [k, before.body[k] ?? null]));
      return records.patch(ctx.company, who(ctx), r.id, set, { ...meta(ctx, `undo revision ${r.rev}`), baseRev: r.rev });
    },
  }),
];
