import { need } from "#lib/server/rs.ts";
import type { PageServerLoad } from "./$types";
import type { Rec } from "../../../../src/core/records.ts";
export const load: PageServerLoad = ({ locals, params }) => ({
  brief: need(locals.rs.run<{ brief: string }>(params.slug, "company.get")).brief,
  projects: need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "project" })),
  knowledge: need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "knowledge", limit: 5 })),
  flags: need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "flag", status: "open", limit: 5 })),
});
