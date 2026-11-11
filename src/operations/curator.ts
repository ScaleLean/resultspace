// Curator findings and suggestions. Agreement never executes a proposed mutation.
// The Curator retains its editor tool scope and does no external company work.
import { EVENT_METADATA } from "../core/assertions.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Company } from "../core/company.ts";
import { forbidden, invalid } from "../core/errors.ts";
import { getKind } from "../core/kinds.ts";
import * as records from "../core/records.ts";
import { canonicalKind, LEGACY_FIELDS } from "../core/schema.ts";
import { Body, meta, op, Ref, who, Why, type Ctx, type Operation } from "./define.ts";

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const CURATOR_KINDS = new Set(["flag", "request", "briefing", "assignment"]);
const CURATOR_WRITES = new Set(["record.create", "record.patch", "request.propose"]);

/**
 * Refuse a Curator write that is not its to make. The Curator may, on its own:
 * - create flags, requests, briefings and assignments (handing an outcome to an agent);
 * - edit its own flags and briefings;
 * - fill an EMPTY reference field on any record (link a result to its project, a task to its project).
 * Everything else is a suggestion for review; agreement never executes it.
 */
export function curatorMay(company: Company, name: string, input: unknown): void {
  const no = (what: string) => forbidden(`the Curator does not ${what} on its own: propose it with request.propose, for review; agreement never executes it`);
  if (!CURATOR_WRITES.has(name)) throw no(`run ${name}`);
  const i = obj(input);
  if (name === "record.create") {
    if (!CURATOR_KINDS.has(canonicalKind(String(i.kind)))) throw no(`create a ${String(i.kind)}`);
    if ("result" in i) throw no("write outcomes (outcomes come from work, and the Curator does no company work)");
    if (canonicalKind(String(i.kind)) === "assignment") {
      const body = obj(i.body);
      const metadata = new Set(["title", "owner", "brief", "project_id", "due_on", "status"]);
      if (Object.keys(body).some((field) => !metadata.has(field)) || ("status" in body && body.status !== "queued"))
        throw no("report work through an assignment body");
    }
  }
  if (name === "record.patch") {
    const r = records.need(company, String(i.ref));
    if ("result" in i) throw no("write outcomes");
    if ((r.kind === "flag" || r.kind === "briefing") && r.updated_by === "curator") return;
    const kind = getKind(company, r.kind);
    for (const [given, value] of Object.entries(obj(i.set))) {
      const field = LEGACY_FIELDS[given] ?? given;
      const isRef = /_ids?$/.test(field) && (kind ? field in kind.refs || /_id$/.test(field) : false);
      const empty = r.body[field] === undefined || r.body[field] === null || r.body[field] === "" || (Array.isArray(r.body[field]) && (r.body[field] as unknown[]).length === 0);
      if (!isRef || !empty || value === null) throw no(`change ${field} of ${r.key}`);
    }
  }
}

export function makeCuratorOperations(find: (name: string) => Operation | undefined): Operation[] {
  return [
    op({
      name: "request.propose", summary: "Propose a change for review; agreement never executes it (the Curator's way to change meaning)", role: "member", write: true,
      input: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 200, description: "The change in one line, as a question a person can answer yes or no" }),
        operation: Type.String({ description: "Suggested operation for separate consideration, e.g. record.patch" }), input: Body,
        why: Type.String({ minLength: 1, maxLength: 1000 }), about: Type.Optional(Ref),
      }),
      run: (ctx, i) => {
        const target = find(i.operation);
        if (!target || !target.write || i.operation.startsWith("request.") || i.operation.startsWith("agent.")) throw invalid(`${i.operation} cannot be proposed`);
        if (!Value.Check(target.input, i.input)) throw invalid(`the input does not fit ${i.operation}: ${[...Value.Errors(target.input, i.input)][0]?.message ?? "bad input"}`);
        const about = i.about ?? (typeof i.input.ref === "string" ? i.input.ref : undefined);
        const body: records.Body = { title: i.title, status: "open", operation: i.operation, input: i.input, why: i.why };
        if (about) body.about_id = records.need(ctx.company, about).id;
        return records.create(ctx.company, who(ctx), "request", body, meta(ctx));
      },
    }),
    op({
      name: "request.decide", summary: "Agree with or decline a suggestion; never execute the proposed mutation", role: "member", write: true,
      input: Type.Object({ ref: Ref, approve: Type.Boolean(), note: Type.Optional(Type.String({ maxLength: 500 })) }),
      run: (ctx, i) => {
        const r = records.need(ctx.company, i.ref);
        if (r.kind !== "request") throw invalid(`${r.key} is a ${r.kind}, not a request`);
        if (r.body.status !== "open") throw invalid(`${r.key} is already ${String(r.body.status)}`);
        return records.patch(ctx.company, who(ctx), r.id, { status: i.approve ? "approved" : "declined", decided_by: ctx.actor.name, decided_at: new Date().toISOString(), ...(i.note ? { note: i.note } : {}) }, meta(ctx));
      },
    }),
    op({
      name: "record.undo", summary: "Put a record back to how it was before its latest change (the change stays in history)", role: "member", write: true,
      input: Type.Object({ ref: Ref, rev: Type.Optional(Type.Integer({ minimum: 2, description: "Only undo if this is still the latest revision" })), why: Why }),
      run: (ctx, i) => {
        const r = records.need(ctx.company, i.ref);
        const hist = records.history(ctx.company, r.id);
        const last = hist.at(-1); const before = hist.at(-2);
        if (!last || !before) throw invalid(`${r.key} has nothing to undo`);
        // Revisions from before schema 3 name fields the old way (work_order_id): read them under today's names.
        const prior = records.modernFields(before.body);
        if (i.rev !== undefined && i.rev !== last.rev) throw invalid(`${r.key} changed again since revision ${i.rev}: read it first`);
        const why = i.why ?? `undo revision ${last.rev} by ${last.actor}`;
        if (last.archived !== before.archived) return records.setArchived(ctx.company, who(ctx), r.id, before.archived, meta(ctx, why));
        const set: records.Body = {};
        for (const changed of last.changed) {
          const f = LEGACY_FIELDS[changed] ?? changed;
          if (r.assertion && !EVENT_METADATA.has(f)) continue;
          if (r.kind === "assignment" && records.ASSIGNMENT_PROVENANCE.has(f)) continue;
          set[f] = f in prior ? prior[f] : null;
        }
        return records.patch(ctx.company, who(ctx), r.id, set, meta(ctx, why));
      },
    }),
    op({
      name: "inbox.get", summary: "Open suggestions, flags, blockers and the latest briefing", role: "viewer", write: false,
      input: Type.Object({}),
      run: (ctx: Ctx) => {
        const co = ctx.company;
        const line = (r: records.Rec) => {
          const about = typeof r.body.about_id === "string" ? records.get(co, r.body.about_id) : undefined;
          return { key: r.key, title: records.titleOf(co, r), at: r.created_at, by: r.updated_by, why: r.body.why ?? r.body.detail ?? null, type: r.body.flag_type ?? r.body.operation ?? null, input: r.body.input ?? null,
            about: about ? { key: about.key, kind: about.kind, title: records.titleOf(co, about) } : null };
        };
        const briefing = records.list(co, { kind: "briefing", limit: 1 })[0];
        // Filter each status in SQL before limiting, then take the newest 50 across both statuses.
        const blockers = ["blocked", "needs_permission"].flatMap((status) => records.list(co, { kind: "assignment", status, limit: 50 }))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.key.localeCompare(a.key)).slice(0, 50);
        return {
          requests: records.list(co, { kind: "request", status: "open", limit: 100 }).map(line),
          flags: records.list(co, { kind: "flag", status: "open", limit: 100 }).map(line),
          needs_you: blockers.map((r) => ({ key: r.key, title: records.titleOf(co, r), owner: r.body.owner ?? null, detail: r.body.progress ?? null })),
          briefing: briefing ? { key: briefing.key, title: records.titleOf(co, briefing), text: briefing.body.text ?? "", at: briefing.created_at } : null,
        };
      },
    }),
  ];
}
