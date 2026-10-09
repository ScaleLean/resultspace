// Everything under /c/<slug>/ gets this data (in a page: `data.slug`, `data.company`, ...; in a server load:
// `const { slug } = await parent()` or just `params.slug`):
//   { slug, company: { slug, name }, companies: { slug, name }[], rail (the Shell's companies), pulse (this company's pulse.get),
//     person: { name, email }, trusted: boolean, needs: number }
// `trusted`: no sign-in from here (same machine or tailnet), so nothing offers to sign out.
// `needs` = open requests, open flags and assignments waiting for an answer. It reloads after every form action.
import { error } from "@sveltejs/kit";
import { pulses, railOf } from "#lib/server/pulse.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, params, cookies, url }) => {
  const rs = locals.rs;
  const companies = rs.companies();
  const company = companies.find((c) => c.slug === params.slug);
  if (!company) error(404, "No such company.");
  cookies.set("rs_last", company.slug, { path: "/", httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 365 * 86400 });
  const all = pulses(rs);
  const own = all.find((x) => x.slug === company.slug);
  const pulse = own ? { ...own, highlights: [] } : null; // the highlights belong to Home, not to every page's data
  const p = rs.person!;
  return { slug: company.slug, company, companies, rail: all.map(railOf), pulse, person: { name: p.name, email: p.email }, trusted: rs.mode === "trusted", needs: pulse?.needs ?? 0 };
};
