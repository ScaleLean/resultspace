import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ locals }) => {
  const companies = locals.rs.companies();
  if (!companies.length) redirect(303, "/setup");
  if (companies.length === 1) redirect(303, `/c/${companies[0]!.slug}`);
  return { companies, rail: companies.map((c) => ({ ...c, needs: 0 })) };
};
