// Upkeep candidates, found by plain queries. The Curator then judges each one. No Pi Durable here.
import type { Company } from "../core/company.ts";
import * as records from "../core/records.ts";
import { ASSIGNMENT_FINAL } from "../core/schema.ts";
import type { UpkeepFinding } from "./prompts.ts";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function upkeepFindings(co: Company, max = 30): UpkeepFinding[] {
  const out: UpkeepFinding[] = [];
  const add = (type: string, r: records.Rec, detail: string) => out.push({ type, key: r.key, title: records.titleOf(co, r), detail });
  const lastResult = new Map<string, string>();
  for (const r of records.list(co, { kind: "entry", where: { type: "outcome" }, limit: 1000 })) {
    const p = r.body.project_id;
    if (typeof p === "string" && (lastResult.get(p) ?? "") < r.created_at) lastResult.set(p, r.created_at);
  }
  for (const p of records.list(co, { kind: "project", status: "active", limit: 200 })) {
    const last = lastResult.get(p.id) ?? p.updated_at;
    if (last < daysAgo(21)) add("stale project", p, `active, no result since ${last.slice(0, 10)}`);
  }
  for (const w of records.list(co, { kind: "assignment", limit: 500 })) {
    const status = String(w.body.status ?? "queued");
    if (ASSIGNMENT_FINAL.includes(status)) continue;
    if (status === "queued" && w.updated_at < daysAgo(2)) add("assignment not claimed", w, `waiting for ${String(w.body.owner)} since ${w.updated_at.slice(0, 10)}`);
    else if (status !== "queued" && w.updated_at < daysAgo(4)) add("assignment stalled", w, `${status} with no change since ${w.updated_at.slice(0, 10)}`);
  }
  for (const t of records.list(co, { kind: "task", status: "blocked", limit: 200 }))
    if (t.updated_at < daysAgo(14)) add("blocked for long", t, `blocked since ${t.updated_at.slice(0, 10)}`);
  for (const kind of ["task", "project", "knowledge"]) {
    const seen = new Map<string, records.Rec>();
    for (const r of records.list(co, { kind, limit: 1000 }).reverse()) {
      if (kind === "task" && r.body.status === "done") continue;
      const k = norm(records.titleOf(co, r));
      if (k.length < 8) continue;
      const first = seen.get(k);
      if (first) add("same title", r, `same title as ${first.key}`); else seen.set(k, r);
    }
  }
  return out.slice(0, max);
}
