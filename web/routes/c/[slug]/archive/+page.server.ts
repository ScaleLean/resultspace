import { need } from "#lib/server/rs.ts";
import type { Rec } from "../../../../../src/core/records.ts";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ locals, params }) => ({
  records: need(locals.rs.run<Rec[]>(params.slug, "archive.list", { limit: 1000 })),
});
