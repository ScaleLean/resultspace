import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params, url }) => redirect(307, `/c/${params.slug}/journal${url.search}`);
