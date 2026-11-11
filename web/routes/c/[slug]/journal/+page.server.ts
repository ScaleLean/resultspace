// The Journal, newest first. Filters are query params: ?type=outcome|action|session|note, ?since=24h|7d|30d (default 7d), ?project=PRJ-0001.
// Action: log (title, type outcome|note, detail, project) writes an entry through journal.log.
import { fail_of, need, str } from "#lib/server/rs.ts";
import type { Rec } from "../../../../../src/core/records.ts";
import { isMachine, type JournalItem } from "../../../../../src/operations/views.ts";
import type { Actions, PageServerLoad } from "./$types";

const SINCE = ["24h", "7d", "30d"];
const TYPES = ["outcome", "action", "session", "note"];

export const load: PageServerLoad = ({ locals, params, url }) => {
  const q = (name: string, allowed: string[], fallback = "") => { const v = url.searchParams.get(name) ?? ""; return allowed.includes(v) ? v : fallback; };
  const since = q("since", SINCE, "7d"), type = q("type", TYPES);
  const projects = need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "project", limit: 500 }))
    .map((p) => ({ key: p.key, title: typeof p.body.title === "string" ? p.body.title : p.key }));
  const project = q("project", projects.map((p) => p.key));
  const all = need(locals.rs.run<JournalItem[]>(params.slug, "journal.list", { since, limit: 500, ...(project ? { project } : {}) }));
  // "All" leaves out machine work: agent sessions (a log of tool calls) and raw commands logged as actions
  // ("ads API: cd ~/x; cat > y.py ..."). They show under their own filter, when looked for.
  const machine = (e: JournalItem) => e.type === "session" || (e.type === "action" && isMachine(e.title));
  const counts: Record<string, number> = { "": 0 };
  for (const e of all) { counts[e.type] = (counts[e.type] ?? 0) + 1; if (!machine(e)) counts[""]!++; }
  const entries = (type ? all.filter((e) => e.type === type) : all.filter((e) => !machine(e))).slice(0, 300);
  return { since, type, project, projects, entries, counts, capped: all.length >= 500 };
};

export const actions: Actions = {
  log: async ({ request, locals, params }) => {
    const form = await request.formData();
    const title = str(form, "title"), type = str(form, "type") === "note" ? "note" : "outcome", detail = str(form, "detail"), project = str(form, "project");
    const back = { title, detail };
    if (!title) return fail_of({ ok: false, error: "Say what happened." }, back);
    const r = locals.rs.run<Rec>(params.slug, "journal.log", { title, type, ...(detail ? { detail } : {}), ...(project ? { project } : {}) });
    if (!r.ok) return fail_of(r, back);
    return { saved: `Logged ${r.result.key}.` };
  },
};
