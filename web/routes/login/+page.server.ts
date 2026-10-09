import { fail, redirect } from "@sveltejs/kit";
import { str } from "#lib/server/rs.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => { if (locals.rs.person) redirect(303, "/"); };

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await request.formData();
    const email = str(form, "email");
    const r = await locals.rs.signIn(email, String(form.get("password") ?? ""));
    if (!r.ok) return fail(r.status, { email, error: r.error });
    locals.setCookie.push(r.cookie);
    redirect(303, "/");
  },
};
