// Home: every company at once. What waits for the owner (acted on in place), what each busy company's agent got
// done, and how every agent is doing. The actions take the company from the form's `slug`. One company goes straight in.
import { redirect } from "@sveltejs/kit";
import type { Inbox } from "./api/c/[slug]/inbox/+server.ts";
import { answer, decide, flag } from "#lib/server/inbox.ts";
import { pulses, railOf } from "#lib/server/pulse.ts";
import { str } from "#lib/server/rs.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  const rs = locals.rs;
  const companies = rs.companies();
  if (companies.length === 0) redirect(303, "/setup");
  if (companies.length === 1) redirect(303, `/c/${companies[0]!.slug}`); // one company: Home would only repeat it
  const all = pulses(rs);
  const waiting = all.filter((p) => p.needs > 0).flatMap((p) => {
    const r = rs.run<Inbox>(p.slug, "inbox.get");
    return r.ok ? [{ slug: p.slug, name: p.name, inbox: r.result }] : [];
  });
  return { pulses: all, rail: all.map(railOf), waiting, person: locals.rs.person ? { name: locals.rs.person.name } : null };
};

const slugOf = (form: FormData) => str(form, "slug");

export const actions: Actions = {
  decide: async ({ request, locals }) => { const f = await request.formData(); return decide(locals.rs, slugOf(f), f); },
  answer: async ({ request, locals }) => { const f = await request.formData(); return answer(locals.rs, slugOf(f), f); },
  flag: async ({ request, locals }) => { const f = await request.formData(); return flag(locals.rs, slugOf(f), f); },
};
