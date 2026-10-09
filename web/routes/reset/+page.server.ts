// The reset link is /reset#<token>: the token is in the fragment so it never reaches server logs; the page posts it.
import { fail_of, str } from "#lib/server/rs.ts";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await request.formData();
    const r = await locals.rs.useReset(str(form, "token"), String(form.get("next") ?? ""), String(form.get("again") ?? ""));
    if (!r.ok) return fail_of(r);
    return { done: true };
  },
};
