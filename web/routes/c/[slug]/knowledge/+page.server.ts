// Knowledge: collections as cards with the latest changes, ?c=<collection> for one collection, or ?q= search within knowledge.
import { need } from "#lib/server/rs.ts";
import type { Hit, Rec } from "../../../../../src/core/records.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, params, url }) => {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 400);
  if (q) return { q, hits: need(locals.rs.run<Hit[]>(params.slug, "record.search", { q, kind: "knowledge", limit: 50 })), groups: [], summary: [], open: null, recent: [], total: 0 };
  const pages = need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind: "knowledge", limit: 1000 }));
  const by = new Map<string, { key: string; title: string; updated_at: string }[]>();
  for (const p of pages) {
    const c = typeof p.body.collection === "string" ? p.body.collection.trim() : "";
    const title = typeof p.body.title === "string" && p.body.title ? p.body.title : p.key;
    by.set(c, [...(by.get(c) ?? []), { key: p.key, title, updated_at: p.updated_at }]);
  }
  // Named collections A-Z; pages without a collection last.
  const groups = [...by].map(([name, items]) => ({ name, items: items.sort((a, b) => a.title.localeCompare(b.title)) }))
    .sort((a, b) => (!a.name ? 1 : !b.name ? -1 : a.name.localeCompare(b.name)));
  const c = url.searchParams.get("c");
  const open = c === null ? null : groups.find((g) => g.name === c) ?? null;
  const recent = [...pages].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 6)
    .map((p) => ({ key: p.key, title: typeof p.body.title === "string" && p.body.title ? p.body.title : p.key, updated_at: p.updated_at, collection: typeof p.body.collection === "string" ? p.body.collection : "" }));
  const summary = groups.map((g) => ({ name: g.name, count: g.items.length, latest: g.items.reduce((m, i) => (i.updated_at > m ? i.updated_at : m), ""),
    sample: [...g.items].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3).map((i) => i.title) }));
  return { q, hits: [] as Hit[], groups, summary, open, recent, total: pages.length };
};
