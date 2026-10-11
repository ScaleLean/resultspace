// Chat with the Curator of one company. Data: { available, chat: ChatState }.
// Actions (plain forms, so they work without JavaScript): say { text, steer? }, stop, new.
// While the page is open it also polls GET /api/c/<slug>/chat for the newest state.
import type { Actions, PageServerLoad } from "./$types";
import type { Finding } from "../../../../../src/curator/scan.ts";
import type { Rec } from "../../../../../src/core/records.ts";
import { need, fail_of, str } from "#lib/server/rs.ts";

export const load: PageServerLoad = async ({ locals, params }) => {
  const v = await locals.rs.curator.view(params.slug);
  return {
    findings: need(locals.rs.run<Finding[]>(params.slug, "curator.scan")),
    flags: need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "flag", status: "open", limit: 200 })),
    available: v.available,
    chat: v.chat,
  };
};

export const actions: Actions = {
  review: ({ locals, params }) => {
    const r = locals.rs.run(params.slug, "curator.review");
    return r.ok ? { ok: true } : fail_of(r);
  },
  say: async ({ locals, params, request }) => {
    const form = await request.formData();
    const text = str(form, "text");
    if (!text) return fail_of({ ok: false, error: "Write a message first." }, { text });
    const r = await locals.rs.curator.say(params.slug, text, str(form, "steer") === "1");
    if (!r.ok) return fail_of(r, { text });
    return { ok: true };
  },
  stop: async ({ locals, params }) => {
    await locals.rs.curator.stop(params.slug);
    return { ok: true };
  },
  new: async ({ locals, params }) => {
    await locals.rs.curator.newChat(params.slug);
    return { ok: true };
  },
};
