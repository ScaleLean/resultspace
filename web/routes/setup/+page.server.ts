// First run. Two faces (data.face):
//   "account": sign-in mode, no account yet. Make the first one; you will be the owner.
//   "company": no company yet (trusted mode, or signed in after the first account). Name it, and give the
//              Curator its model key if you have one. Everything else works without a key.
// hooks.server.ts sends everything here while rs.needsSetup, and lets a signed-in person without a company in.
import { redirect } from "@sveltejs/kit";
import { fail_of, str } from "#lib/server/rs.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  const rs = locals.rs;
  const face = rs.mode === "signin" && rs.needsSetup ? "account" : "company";
  return { face, mode: rs.mode };
};

export const actions: Actions = {
  account: async ({ request, locals }) => {
    const form = await request.formData();
    const name = str(form, "name"), email = str(form, "email");
    const r = await locals.rs.setup(name, email, String(form.get("password") ?? ""));
    if (!r.ok) return fail_of(r, { name, email });
    if (r.cookie) locals.setCookie.push(r.cookie);
    redirect(303, "/");
  },
  testKey: async ({ request, locals }) => {
    const form = await request.formData();
    const name = str(form, "name"), slug = str(form, "slug");
    const t = await locals.rs.modelKey.test(str(form, "key"));
    return { name, slug, tested: t.message, testedOk: t.ok };
  },
  company: async ({ request, locals }) => {
    const form = await request.formData();
    const name = str(form, "name"), slug = str(form, "slug"), key = str(form, "key");
    const r = locals.rs.createCompany(slug, name);
    if (!r.ok) return fail_of(r, { name, slug });
    if (key) {
      const k = await locals.rs.modelKey.set(key);
      // The company exists; only the key was refused. Say so and offer to go on without it.
      if (!k.ok) return fail_of(k, { name, slug, created: r.slug });
    }
    redirect(303, `/c/${r.slug}`);
  },
};
