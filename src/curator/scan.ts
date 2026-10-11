// Deterministic candidates with revision-level evidence, never an automatic correction.
import type { Company } from "../core/company.ts";
import * as records from "../core/records.ts";
import { evidence, type Evidence } from "../core/context.ts";

export type Finding = { type: string; key: string; title: string; detail: string; evidence: Evidence[]; signature: string };
const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
export function upkeepFindings(co: Company, max = 100): Finding[] {
  // Query all live claims: correctness must not depend on record.list's pagination cap.
  const live = co
    .all<{ id: string }>(
      `select id from records where archived = 0 and id not in (select record_id from legacy_records)
    and (kind in ('fact','knowledge','project','issue_note') or (kind = 'entry' and json_extract(body, '$.type') = 'learning')) order by key`,
    )
    .map((x) => records.need(co, x.id));
  const out: Finding[] = [];
  const add = (type: string, rs: records.Rec[], detail: string) =>
    out.push({
      type,
      key: rs[0]!.key,
      title: `${type}: ${records.titleOf(co, rs[0]!)}`,
      detail,
      evidence: rs.map((r) => evidence(co, r)),
      signature: `${type}:${rs
        .flatMap((r) => [r, ...evidence(co, r).sources])
        .map((r) => `${r.id}@${r.rev}`)
        .sort()
        .join(":")}`,
    });
  const groups = new Map<string, records.Rec[]>();
  for (const r of live) {
    if (r.kind === "fact") {
      const group = records.stable([norm(r.body.subject), norm(r.body.predicate), norm(r.body.scope), norm(r.body.unit)]);
      groups.set(group, [...(groups.get(group) ?? []), r]);
    }
    if (["fact", "knowledge"].includes(r.kind) || (r.kind === "entry" && r.body.type === "learning")) {
      const sourced = records.hasCurrentSource(co, r.body) || (r.kind !== "entry" && typeof r.body.url === "string" && r.body.url.trim());
      if (!sourced) add("unsupported", [r], "No current source is cited. Review this claim before relying on it.");
      const date = typeof r.body.observed_at === "string" ? r.body.observed_at : r.updated_at;
      if (Date.parse(date) < Date.now() - 90 * 86400000) add("stale", [r], `Last observation or update ${date}; confirm it still holds.`);
    }
    if (
      ["project", "issue_note"].includes(r.kind) &&
      !["complete", "resolved", "dismissed", "archived"].includes(String(r.body.status)) &&
      Date.parse(r.updated_at) < Date.now() - 21 * 86400000
    )
      add("stale", [r], `No recorded update since ${r.updated_at}; suggest reviewing current state.`);
  }
  for (const group of groups.values()) {
    const values = new Set(group.map((r) => records.stable([r.body.value_type, r.body.value])));
    if (values.size > 1)
      add(
        "contradiction",
        group,
        "Different values for the same subject, predicate, scope and unit. Both claims remain unchanged; compare their sources and observation dates.",
      );
  }
  return out.sort((a, b) => (a.type === "contradiction" ? -1 : 0) - (b.type === "contradiction" ? -1 : 0)).slice(0, max);
}
