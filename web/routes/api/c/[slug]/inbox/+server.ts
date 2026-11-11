// GET /api/c/{slug}/inbox: the Today data as JSON (the Today page loads the same thing through _today).
import { json } from "@sveltejs/kit";
import type { WebService } from "../../../../../../src/web/service.ts";
import { isMachine } from "../../../../../../src/operations/views.ts";
import type { Assignment } from "../../../../../../src/operations/assignments.ts";
import { need } from "#lib/server/rs.ts";
import type { RequestHandler } from "./$types";

export type About = { key: string; kind: string; title: string } | null;
export type InboxLine = { key: string; title: string; at: string; by: string; why: string | null; type: string | null; input?: unknown; about: About };
export type Inbox = {
  requests: InboxLine[]; flags: InboxLine[];
  needs_you: { key: string; title: string; owner: string | null; detail: string | null }[];
  briefing: { key: string; title: string; text: string; at: string } | null;
};
export type JournalLine = { key: string; type: string; at: string; by: string; title: string; detail: unknown; about: About; project: string | null; assignment: string | null; work_order: string | null };
// `work`: the open assignments (the key keeps its old name; this JSON is read by the Today page).
export type Today = { inbox: Inbox; journal: JournalLine[]; work: Assignment[]; recent: JournalLine[]; counts: Record<string, number>; machine: number };

/** Everything the Today page shows. Throws a SvelteKit error page when the person may not read the company. */
export function _today(rs: WebService, slug: string): Today {
  const day = need(rs.run<JournalLine[]>(slug, "journal.list", { since: "24h", limit: 500 }));
  const counts: Record<string, number> = { outcome: 0, action: 0, session: 0, note: 0 };
  for (const e of day) counts[e.type] = (counts[e.type] ?? 0) + 1;
  // Raw commands an agent logged as actions ("ads API: cd ~/x; cat > y.py <<EOF") are machine work, not news: counted, not shown.
  const news = (e: JournalLine) => e.type === "outcome" || e.type === "note" || (e.type === "action" && !isMachine(e.title));
  const machine = day.filter((e) => e.type === "action" && isMachine(e.title)).length;
  const journal = day.filter(news).slice(0, 60);
  return {
    inbox: need(rs.run<Inbox>(slug, "inbox.get", {})),
    // The last day's outcomes, notes and outward actions, together (sessions stay on the Journal page).
    journal, machine,
    // A quiet day still shows what happened last: the latest outcomes and actions of the past month.
    recent: journal.length ? [] : need(rs.run<JournalLine[]>(slug, "journal.list", { since: "30d", limit: 60 })).filter(news).slice(0, 8),
    counts,
    work: need(rs.run<Assignment[]>(slug, "assignment.list", { limit: 100 })),
  };
}

export const GET: RequestHandler = ({ locals, params }) => json(_today(locals.rs, params.slug), { headers: { "cache-control": "no-store" } });
