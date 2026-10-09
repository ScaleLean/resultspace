// Skills: this company's own first, then the shared ones (read-only here). Filters: ?q=words, ?status=draft|active|retired.
// Action: add (title, when, body, status, knowledge = comma-separated knowledge keys) creates a skill through record.create.
import { fail_of, need, str } from "#lib/server/rs.ts";
import type { Rec } from "../../../../../src/core/records.ts";
import type { SkillItem } from "../../../../../src/operations/skills.ts";
import type { Actions, PageServerLoad } from "./$types";

const STATUSES = ["draft", "active", "retired"];

export const load: PageServerLoad = ({ locals, params, url }) => {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const status = STATUSES.includes(url.searchParams.get("status") ?? "") ? url.searchParams.get("status")! : "";
  const all = need(locals.rs.run<SkillItem[]>(params.slug, "skill.list", { ...(q ? { q } : {}), ...(status ? { status } : {}) }));
  const knowledge = need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "knowledge", limit: 500 }))
    .map((k) => ({ key: k.key, title: typeof k.body.title === "string" ? k.body.title : k.key }));
  return { q, status, statuses: STATUSES, own: all.filter((s) => !s.shared), shared: all.filter((s) => s.shared), knowledge };
};

export const actions: Actions = {
  add: async ({ request, locals, params }) => {
    const form = await request.formData();
    const title = str(form, "title"), when = str(form, "when"), body = str(form, "body"), status = str(form, "status"), knowledge = str(form, "knowledge");
    const back = { title, when, body, knowledge };
    if (!title) return fail_of({ ok: false, error: "Give the skill a title." }, back);
    if (!STATUSES.includes(status)) return fail_of({ ok: false, error: "Pick a status." }, back);
    // Keys like KNW-0003 are resolved to ids by the server (knowledge_ids must point at knowledge records).
    const knowledge_ids = knowledge.split(/[,\s]+/).map((k) => k.trim()).filter(Boolean);
    const r = locals.rs.run<Rec>(params.slug, "record.create", { kind: "skill", body: { title, when, body, status, knowledge_ids } });
    if (!r.ok) return fail_of(r, back);
    return { saved: `Added ${r.result.key}.` };
  },
};
