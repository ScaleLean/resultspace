// Admin: the Curator's model key and settings and runs, the company brief, agents and their keys, record kinds,
// and a form to make another company.
// A new agent key travels only in the action's result (`form.key`): it is never stored or logged here.
// The model key is never shown: only whether one is set.
import { fail, redirect } from "@sveltejs/kit";
import { fail_of, need, str } from "#lib/server/rs.ts";
import type { Actions, PageServerLoad } from "./$types";

type Company = { slug: string; name: string; key: string | null; brief: string; kinds: { kind: string; live: number; archived: number }[] };
type Agent = { name: string; role: "viewer" | "member" | "admin"; active: boolean; created_at: string; last_seen: string | null };
type Kind = { kind: string; prefix: string; title_field: string; statuses: string[] | null; refs: Record<string, string | null> };

const THINKING = ["off", "low", "medium", "high"] as const;
const DUTIES = ["review", "briefing", "upkeep"] as const;
const ROLES = ["viewer", "member", "admin"] as const;
const bad = (section: string, error: string) => fail(400, { section, error });
const badSettings = (error: string) => fail(400, { section: "curator", settings: true, error });

export const load: PageServerLoad = async ({ locals, params }) => {
  const rs = locals.rs;
  const company = need(rs.run<Company>(params.slug, "company.get"));
  const agents = need(rs.run<Agent[]>(params.slug, "agent.list"));
  const kinds = need(rs.run<Kind[]>(params.slug, "kind.list"));
  const v = await rs.curator.view(params.slug);
  const counts = new Map(company.kinds.map((k) => [k.kind, k]));
  return {
    modelKey: rs.modelKey.status(),
    curator: { available: v.available, settings: v.settings, spent_today: v.spent_today, runs: v.runs.slice(0, 15) },
    brief: company.brief,
    agents,
    kinds: kinds.map((k) => ({ ...k, live: counts.get(k.kind)?.live ?? 0, archived: counts.get(k.kind)?.archived ?? 0 })),
  };
};

export const actions: Actions = {
  testKey: async ({ request, locals }) => {
    const t = await locals.rs.modelKey.test(str(await request.formData(), "key"));
    return t.ok ? { section: "key", done: t.message } : bad("key", t.message);
  },
  setKey: async ({ request, locals }) => {
    const r = await locals.rs.modelKey.set(str(await request.formData(), "key"));
    return r.ok ? { section: "key", done: r.message } : bad("key", r.message);
  },
  newCompany: async ({ request, locals }) => {
    const f = await request.formData();
    const name = str(f, "name"), slug = str(f, "slug");
    const r = locals.rs.createCompany(slug, name);
    if (!r.ok) return fail(400, { section: "company", error: r.error, name, slug });
    redirect(303, `/c/${r.slug}`);
  },
  settings: async ({ request, locals, params }) => {
    const f = await request.formData();
    const thinking = THINKING.find((t) => t === str(f, "thinking"));
    const cap = Number(str(f, "daily_cap_usd"));
    const model = str(f, "model"), model_strong = str(f, "model_strong");
    if (!thinking) return badSettings("Pick a thinking level.");
    if (!Number.isFinite(cap) || cap < 0 || cap > 1000) return badSettings("The daily limit must be a number from 0 to 1000.");
    if (!model || !model_strong) return badSettings("Both models need a name.");
    try {
      locals.rs.curator.saveSettings(params.slug, { auto: f.has("auto"), model, model_strong, thinking, daily_cap_usd: cap, instructions: str(f, "instructions").slice(0, 8000) });
    } catch (e) { return badSettings(e instanceof Error ? e.message : "That did not work."); }
    return { section: "curator", done: "Settings saved." };
  },
  duty: async ({ request, locals, params }) => {
    const asked = str(await request.formData(), "duty");
    const duty = DUTIES.find((d) => d === asked);
    if (!duty) return bad("curator", "Unknown job.");
    try {
      const r = await locals.rs.curator.runDuty(params.slug, duty);
      if (!r) return bad("curator", "The Curator is off.");
      const line = `${duty[0]!.toUpperCase()}${duty.slice(1)} ${r.status}${r.detail ? `: ${r.detail.replace(/\s+/g, " ").slice(0, 200)}` : "."}`;
      return r.status === "failed" ? bad("curator", line) : { section: "curator", done: line, cost: r.cost_usd };
    } catch (e) { return bad("curator", e instanceof Error ? e.message : "That did not work."); }
  },
  brief: async ({ request, locals, params }) => {
    const brief = String((await request.formData()).get("brief") ?? "");
    const r = locals.rs.run(params.slug, "company.update", { brief });
    return r.ok ? { section: "brief", done: "Brief saved." } : fail_of(r, { section: "brief" });
  },
  addAgent: async ({ request, locals, params }) => {
    const f = await request.formData();
    const name = str(f, "name").toLowerCase();
    const role = ROLES.find((x) => x === str(f, "role")) ?? "member";
    const r = locals.rs.run(params.slug, "agent.add", { name, role });
    return r.ok ? { section: "agents", done: `Added ${name}. Make a key for it next.` } : fail_of(r, { section: "agents", name });
  },
  newKey: async ({ request, locals, params }) => {
    const name = str(await request.formData(), "name");
    const r = locals.rs.run<{ agent: string; key: string }>(params.slug, "agent.key", { name });
    return r.ok ? { section: "agents", agent: r.result.agent, key: r.result.key } : fail_of(r, { section: "agents" });
  },
  revoke: async ({ request, locals, params }) => {
    const name = str(await request.formData(), "name");
    const r = locals.rs.run(params.slug, "agent.revoke", { name });
    return r.ok ? { section: "agents", done: `Every key of ${name} is revoked.` } : fail_of(r, { section: "agents" });
  },
};
