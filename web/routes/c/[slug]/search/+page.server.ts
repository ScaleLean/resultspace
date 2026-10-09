// Search all records. ?q=words
import { need } from "#lib/server/rs.ts";
import type { Hit } from "../../../../../src/core/records.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, params, url }) => {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 400);
  const hits = q ? need(locals.rs.run<Hit[]>(params.slug, "record.search", { q, limit: 50 })) : [];
  return { q, hits };
};
