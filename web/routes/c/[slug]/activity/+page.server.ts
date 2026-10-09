// Every change, newest first. ?since=24h (default) | 7d.
import { need } from "#lib/server/rs.ts";
import type { PageServerLoad } from "./$types";

export type Change = { seq: number; at: string; actor: string; actor_kind: string; key: string; kind: string; title: string; op: string; changed: string[]; why: string | null };

export const load: PageServerLoad = ({ locals, params, url }) => {
  const since = url.searchParams.get("since") === "7d" ? "7d" : "24h";
  const limit = 500;
  const changes = need(locals.rs.run<Change[]>(params.slug, "activity.list", { since, limit }));
  return { since, changes, full: changes.length >= limit };
};
