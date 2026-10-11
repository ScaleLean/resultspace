import { redirect } from "@sveltejs/kit";
import { authorBody } from "#lib/server/author.ts";
import { need, fail_of } from "#lib/server/rs.ts";
import type { Rec } from "../../../../../src/core/records.ts";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ locals, params }) => ({
  kind: "project",
  label: "Projects",
  records: need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "project", limit: 200 })),
});
export const actions: Actions = {
  create: async ({ locals, params, request }) => {
    let body;
    try {
      body = authorBody(await request.formData(), "project");
    } catch (e) {
      return fail_of({ ok: false, error: e instanceof Error ? e.message : "Invalid input" });
    }
    const r = locals.rs.run<Rec>(params.slug, "record.create", { kind: "project", body });
    if (!r.ok) return fail_of(r);
    redirect(303, `/c/${params.slug}/r/${r.result.key}`);
  },
};
