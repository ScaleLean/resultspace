// Account and access. Who can get in, from where, and the password for getting in from anywhere else.
// In trusted mode (this machine, the tailnet) the owner may make the sign-in account or set its password
// without the old one; from elsewhere the current password is needed.
import { redirect } from "@sveltejs/kit";
import { fail_of } from "#lib/server/rs.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, cookies }) => {
  const p = locals.rs.person!;
  const access = locals.rs.access();
  return { person: { name: p.name, email: p.email }, trusted: access.mode === "trusted", account: access.account, session: p.email !== "" && access.mode === "signin",
    back: cookies.get("rs_last") ? `/c/${cookies.get("rs_last")}` : "/" };
};

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export const actions: Actions = {
  password: async ({ request, locals }) => {
    const f = await request.formData();
    const r = await locals.rs.changePassword(str(f, "current"), str(f, "next"), str(f, "again"));
    return r.ok ? { done: true } : fail_of(r);
  },
  set: async ({ request, locals }) => {
    const f = await request.formData();
    const r = await locals.rs.setPassword(str(f, "next"), str(f, "again"));
    return r.ok ? { done: true } : fail_of(r);
  },
  account: async ({ request, locals }) => {
    const f = await request.formData();
    const r = await locals.rs.setAccount(str(f, "name").trim().toLowerCase(), str(f, "email").trim(), str(f, "password"), str(f, "again"));
    return r.ok ? { made: true } : fail_of(r);
  },
  signout: ({ locals }) => {
    locals.setCookie.push(locals.rs.signOut().cookie);
    redirect(303, locals.rs.mode === "trusted" ? "/" : "/login");
  },
};
