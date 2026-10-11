import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import type { Rec } from "../../../../src/core/records.ts";
export const load: LayoutServerLoad = ({ locals, params }) => {
  const companies = locals.rs.companies();
  const company = companies.find((c) => c.slug === params.slug);
  if (!company) error(404, "No such company");
  const rail = companies.map((c) => {
    const r = locals.rs.run<Rec[]>(c.slug, "record.list", { kind: "flag", status: "open", limit: 1000 });
    return { ...c, needs: r.ok ? r.result.length : 0 };
  });
  return {
    slug: company.slug,
    company,
    companies,
    rail,
    person: locals.rs.person!,
    trusted: locals.rs.mode === "trusted",
    needs: rail.find((c) => c.slug === params.slug)?.needs ?? 0,
  };
};
