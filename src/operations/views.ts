import { Type } from "typebox";
import * as records from "../core/records.ts";
import type { Company } from "../core/company.ts";
import { projectContext } from "../core/context.ts";
import { Limit, meta, op, Ref, sinceTime, who, type Operation } from "./define.ts";
export const WRITING_RULES = [
  "State what changed or what you learned.",
  "Cite sources and distinguish observations from assumptions.",
  "Keep project state and planning notes clear and brief.",
];
export const companyRecord = (co: Company) => records.list(co, { kind: "company", limit: 1 })[0];
export function briefText(co: Company, _agent: string | null, budget = 4000): string {
  const projects = records.list(co, { kind: "project", limit: 20 });
  return [
    `## ${co.name} (${co.slug})`,
    String(companyRecord(co)?.body.brief ?? ""),
    "Projects:",
    ...projects.map((r) => `${r.key} ${records.titleOf(co, r)}: ${String(r.body.current_state ?? "")}`),
    "Read focused context with rs project context KEY. Read facts and sources before acting. Work with your own runtime and tools, then record sourced learning or outcome. ResultSpace stores knowledge and planning notes; it does not execute or authorize work.",
    ...WRITING_RULES,
  ]
    .join("\n")
    .slice(0, budget);
}
export function journalItems(
  co: Company,
  o: { type?: string | undefined; since?: string | undefined; limit?: number | undefined; project?: string | undefined } = {},
) {
  return records.journalRecords(co, { ...o, since: o.since ? sinceTime(o.since, 24) : undefined }).map((r) => {
    const history = records.history(co, r.id);
    const first = history[0]!;
    const last = history.at(-1)!;
    const scope = records.projectScope(co, r);
    const about = typeof r.body.about_id === "string" ? records.get(co, r.body.about_id) : undefined;
    return {
      key: r.key,
      type: String(r.body.type ?? "note"),
      at: r.created_at,
      by: last.actor,
      rev: last.rev,
      updated_at: last.at,
      original: {
        actor: first.actor,
        actor_kind: first.actor_kind,
        at: first.at,
        rev: first.rev,
        body: first.body,
      },
      title: records.titleOf(co, r),
      detail: r.body.detail ?? r.body.text ?? null,
      source: r.body.source ?? null,
      source_ids: r.body.source_ids ?? [],
      claim_provenance: records.provenance(co, r).provenance,
      project_scope: scope,
      project: scope.project_id ? records.need(co, scope.project_id).key : null,
      about: about ? { ...about, title: records.titleOf(co, about) } : null,
    };
  });
}
export type JournalItem = ReturnType<typeof journalItems>[number];
export function activityItems(co: Company, since: string, limit: number) {
  return co
    .all<{
      seq: number;
      at: string;
      actor: string;
      actor_kind: string;
      key: string;
      kind: string;
      title: string | null;
      op: string;
      changed: string;
      why: string | null;
    }>(
      `select v.seq,v.at,v.actor,v.actor_kind,r.key,r.kind,f.title,v.op,v.changed,v.why from revisions v
   join records r on r.id=v.record_id left join records_fts f on f.id=r.id where v.at>=? order by v.seq desc limit ?`,
      since,
      limit,
    )
    .map((r) => ({ ...r, title: r.title ?? r.key, changed: JSON.parse(r.changed) as string[] }));
}
export const viewOperations: Operation[] = [
  op({
    name: "project.context",
    summary: "Focused goal, objectives, state, sourced facts, learning, chronological log and issue notes",
    role: "viewer",
    write: false,
    input: Type.Object({ ref: Ref, limit: Limit(200) }),
    run: (ctx, i) => projectContext(ctx.company, i.ref, i.limit),
  }),
  op({
    name: "brief.get",
    summary: "Company knowledge brief and projects",
    role: "viewer",
    write: false,
    input: Type.Object({ budget: Type.Optional(Type.Integer({ minimum: 500, maximum: 20000 })) }),
    run: (ctx, i) => ({ text: briefText(ctx.company, null, i.budget), company: ctx.company.slug, actor: ctx.actor }),
  }),
  op({
    name: "journal.log",
    summary: "Record a sourced outcome, learning or note",
    role: "member",
    write: true,
    input: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 300 }),
      type: Type.Optional(Type.Union([Type.Literal("outcome"), Type.Literal("learning"), Type.Literal("note")])),
      detail: Type.Optional(Type.String({ maxLength: 8000 })),
      about: Type.Optional(Ref),
      project: Type.Optional(Ref),
      source: Type.Optional(Type.String({ maxLength: 2000 })),
      source_ids: Type.Optional(Type.Array(Ref)),
    }),
    run: (ctx, i) =>
      records.logEntry(
        ctx.company,
        who(ctx),
        i.type ?? "outcome",
        i.title,
        i.about ? records.need(ctx.company, i.about) : null,
        meta(ctx),
        {
          ...(i.detail ? { detail: i.detail } : {}),
          ...(i.project ? { project_id: i.project } : {}),
          ...(i.source ? { source: i.source } : {}),
          ...(i.source_ids ? { source_ids: i.source_ids } : {}),
        },
      ),
  }),
  op({
    name: "journal.list",
    summary: "Meaningful company or project log, newest first",
    role: "viewer",
    write: false,
    input: Type.Object({
      type: Type.Optional(Type.String()),
      since: Type.Optional(Type.String()),
      project: Type.Optional(Ref),
      limit: Limit(500),
    }),
    run: (ctx, i) => journalItems(ctx.company, { ...i, since: i.since ? sinceTime(i.since, 24) : undefined }),
  }),
  op({
    name: "activity.list",
    summary: "Server-attributed record changes",
    role: "viewer",
    write: false,
    input: Type.Object({ since: Type.Optional(Type.String()), limit: Limit(1000) }),
    run: (ctx, i) => activityItems(ctx.company, sinceTime(i.since, 24), i.limit ?? 200),
  }),
  op({
    name: "archive.list",
    summary: "Read-only retired records; original keys and history remain accessible",
    role: "viewer",
    write: false,
    input: Type.Object({ limit: Limit(1000) }),
    run: (ctx, i) =>
      ctx.company
        .all<{
          id: string;
        }>("select r.id from records r join legacy_records l on l.record_id = r.id order by r.key limit ?", i.limit ?? 200)
        .map((x) => records.need(ctx.company, x.id)),
  }),
  op({
    name: "company.get",
    summary: "Company brief and record counts",
    role: "viewer",
    write: false,
    input: Type.Object({}),
    run: (ctx) => ({
      slug: ctx.company.slug,
      name: ctx.company.name,
      brief: companyRecord(ctx.company)?.body.brief ?? "",
      kinds: ctx.company.all(
        "select kind, sum(archived = 0) as live, sum(archived = 1) as archived from records where id not in (select record_id from legacy_records) group by kind",
      ),
      last_seq: ctx.company.one<{ n: number }>("select coalesce(max(seq),0) as n from revisions")!.n,
    }),
  }),
  op({
    name: "company.update",
    summary: "Update company brief",
    role: "admin",
    write: true,
    input: Type.Object({ brief: Type.String({ maxLength: 12000 }) }),
    run: (ctx, i) => {
      const r = companyRecord(ctx.company);
      return r
        ? records.patch(ctx.company, who(ctx), r.id, i, meta(ctx))
        : records.create(ctx.company, who(ctx), "company", { name: ctx.company.name, ...i }, meta(ctx));
    },
  }),
];
