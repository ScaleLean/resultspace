import { answer, decide, flag } from "#lib/server/inbox.ts";
import { _today } from "../../api/c/[slug]/inbox/+server.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, params }) => _today(locals.rs, params.slug);

export const actions: Actions = {
  decide: async ({ request, locals, params }) => decide(locals.rs, params.slug, await request.formData()),
  answer: async ({ request, locals, params }) => answer(locals.rs, params.slug, await request.formData()),
  flag: async ({ request, locals, params }) => flag(locals.rs, params.slug, await request.formData()),
};
