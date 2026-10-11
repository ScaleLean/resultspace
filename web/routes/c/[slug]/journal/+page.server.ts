import { redirect } from "@sveltejs/kit";
import { authorBody } from "#lib/server/author.ts";
import { need, fail_of } from "#lib/server/rs.ts";
import type { JournalItem } from "../../../../../src/operations/views.ts";
import type { Rec } from "../../../../../src/core/records.ts";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ locals, params, url }) => ({
  entries: need(
    locals.rs.run<JournalItem[]>(params.slug, "journal.list", {
      ...(url.searchParams.get("project") ? { project: url.searchParams.get("project") } : {}),
      limit: 200,
    }),
  ),
});
export const actions: Actions = {
  log: async ({ locals, params, request }) => {
    const body = authorBody(await request.formData(), "entry");
    const r = locals.rs.run<Rec>(params.slug, "record.create", { kind: "entry", body });
    if (!r.ok) return fail_of(r);
    redirect(303, `/c/${params.slug}/r/${r.result.key}`);
  },
};
