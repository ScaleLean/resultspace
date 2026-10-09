// The old address of an assignment (work orders became assignments). Bookmarks and links keep working.
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => redirect(308, `/c/${params.slug}/assignments/${encodeURIComponent(params.key)}`);
