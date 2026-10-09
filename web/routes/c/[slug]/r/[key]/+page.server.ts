// The page of one record of any kind: fields, links, history, edit, undo, archive.
// Actions: ?/patch (rev, why, title, status, f.<field>...), ?/undo (rev), ?/archive, ?/restore.
import { fail_of, need, str } from "#lib/server/rs.ts";
import type { Link, Rec, Revision } from "../../../../../../src/core/records.ts";
import type { JournalItem } from "../../../../../../src/operations/views.ts";
import type { Assignment } from "../../../../../../src/operations/assignments.ts";
import type { Actions, PageServerLoad } from "./$types";

type Kind = { kind: string; title_field?: string | null; statuses?: string[] | null };
type Change = { field: string; from: string; to: string };
type HistoryLine = { rev: number; at: string; actor: string; actor_kind: string; op: string; why: string | null; archived: boolean; changes: Change[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A body field the edit form offers: a plain string that is not a reference to another record. */
const editable = (k: string, v: unknown, skip: string[]): v is string => typeof v === "string" && !k.startsWith("_") && !skip.includes(k) && !UUID.test(v);
const short = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
};
const clean = (s: string) => s.replace(/\r\n/g, "\n").trim();

export const load: PageServerLoad = ({ locals, params }) => {
  const { slug, key } = params;
  const rs = locals.rs;
  const ctx = need(rs.run<{ record: Rec; links: { out: Link[]; in: Link[] } }>(slug, "record.context", { ref: key }));
  const rec = ctx.record;
  const kinds = rs.run<Kind[]>(slug, "kind.list", {});
  const kind = (kinds.ok && Array.isArray(kinds.result) ? kinds.result.find((k) => k.kind === rec.kind) : undefined) ?? { kind: rec.kind };
  const titleField = typeof kind.title_field === "string" && kind.title_field ? kind.title_field : "title" in rec.body || !("name" in rec.body) ? "title" : "name";
  const pick = (v: unknown) => (typeof v === "string" && v ? v : "");
  const title = pick(rec.body[titleField]) || pick(rec.body.title) || pick(rec.body.name) || rec.key;

  const revs = need(rs.run<Revision[]>(slug, "record.history", { ref: rec.id }));
  const history: HistoryLine[] = revs.map((v, i) => {
    const before = i > 0 ? revs[i - 1]!.body : {};
    return {
      rev: v.rev, at: v.at, actor: v.actor, actor_kind: v.actor_kind, op: v.op, why: v.why, archived: v.archived,
      changes: i === 0 ? [] : v.changed.map((f) => ({ field: f, from: short(before[f]), to: short(v.body[f]) })),
    };
  }).reverse();

  const list = <T,>(op: string, input: Record<string, unknown>): T[] => { const r = rs.run<T[]>(slug, op, input); return r.ok && Array.isArray(r.result) ? r.result : []; };
  const entries = rec.kind === "project" ? list<JournalItem>("journal.list", { project: rec.id, limit: 50 }) : [];
  // Skills cite the knowledge they depend on (knowledge_ids), so they show up as incoming links of kind skill.
  const skills = rec.kind === "knowledge" ? ctx.links.in.filter((l) => l.kind === "skill") : [];
  // Every assignment of the project, finished ones too.
  const assignments = rec.kind === "project" ? list<Assignment>("assignment.list", { project: rec.id, all: true, limit: 100 }) : [];
  const projects = rec.kind === "goal" ? list<Rec>("record.list", { kind: "project", where: { goal_id: rec.id }, limit: 100 }) : [];

  const fields = Object.entries(rec.body).filter(([k, v]) => editable(k, v, [titleField, "status"])).map(([k, v]) => ({ name: k, value: v as string }));
  return {
    rec, title, titleField, statuses: Array.isArray(kind.statuses) ? kind.statuses : null, links: ctx.links, history,
    canUndo: revs.length > 1, fields, entries, skills, assignments, projects,
  };
};

export const actions: Actions = {
  patch: async ({ request, locals, params }) => {
    const form = await request.formData();
    const got = locals.rs.run<Rec>(params.slug, "record.get", { ref: params.key });
    if (!got.ok) return fail_of(got);
    const body = got.result.body;
    const titleField = str(form, "title_field") || "title";
    const set: Record<string, unknown> = {};
    const take = (field: string, input: string) => {
      const raw = form.get(input);
      if (typeof raw !== "string") return;
      const next = clean(raw);
      const cur = body[field];
      if (cur !== undefined && typeof cur !== "string") return;
      if (next !== clean(cur ?? "")) set[field] = next;
    };
    take(titleField, "title");
    take("status", "status");
    for (const name of form.keys()) if (name.startsWith("f.") && editable(name.slice(2), body[name.slice(2)], [titleField, "status"])) take(name.slice(2), name);
    if (set[titleField] === "") return fail_of({ ok: false, error: "The title cannot be empty." });
    if (set.status === "") set.status = null;
    if (!Object.keys(set).length) return { ok: "Nothing changed." };
    const rev = Number(str(form, "rev"));
    const r = locals.rs.run(params.slug, "record.patch", { ref: params.key, set, ...(rev >= 1 ? { base_rev: rev } : {}), ...(str(form, "why") ? { why: str(form, "why") } : {}) });
    return r.ok ? { ok: "Saved." } : fail_of(r);
  },
  undo: async ({ request, locals, params }) => {
    const rev = Number(str(await request.formData(), "rev"));
    const r = locals.rs.run(params.slug, "record.undo", { ref: params.key, ...(rev >= 2 ? { rev } : {}) });
    return r.ok ? { ok: "Undone. The change stays in the history." } : fail_of(r);
  },
  archive: ({ locals, params }) => {
    const r = locals.rs.run(params.slug, "record.archive", { ref: params.key });
    return r.ok ? { ok: "Archived." } : fail_of(r);
  },
  restore: ({ locals, params }) => {
    const r = locals.rs.run(params.slug, "record.restore", { ref: params.key });
    return r.ok ? { ok: "Restored." } : fail_of(r);
  },
};
