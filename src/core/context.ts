// Focused project context and evidence. No task selection or runtime instructions.
import type { Company } from "./company.ts";
import { invalid } from "./errors.ts";
import * as records from "./records.ts";

export function evidence(co: Company, r: records.Rec) {
  const sourceIds = Array.isArray(r.body.source_ids) ? r.body.source_ids : [];
  return {
    record: r,
    ...records.provenance(co, r),
    project_scope: records.projectScope(co, r),
    sources: sourceIds.flatMap((id) => {
      const s = typeof id === "string" ? records.get(co, id) : undefined;
      return s ? [s] : [];
    }),
  };
}
export type Evidence = ReturnType<typeof evidence>;
export function projectContext(co: Company, ref: string, limit = 100) {
  const project = records.need(co, ref);
  if (project.kind !== "project" || records.isLegacy(co, project.id))
    throw invalid(`${project.key} is not an active project record`);
  // Direct project relationships and explicit citations, including company facts shared across projects.
  const ids = co.all<{ id: string }>(
    `select distinct r.id from records r where r.archived = 0
    and r.id not in (select record_id from legacy_records) and r.id <> ? and
    (json_extract(r.body, '$.project_id') = ? or r.id in (select to_id from links where from_id = ?)
      or r.id in (select from_id from links where to_id = ?)) order by r.created_at, r.key`,
    project.id,
    project.id,
    project.id,
    project.id,
  );
  const journal = records.journalRecords(co, { limit: null });
  const relevant = [
    ...ids.map((x) => records.need(co, x.id)).filter((r) => r.kind !== "entry"),
    ...journal.filter((r) => records.projectScope(co, r).project_id === project.id),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.key.localeCompare(b.key));
  const scopeConflicts = journal.filter((r) => {
    const scope = records.projectScope(co, r);
    return scope.problem && scope.projects.includes(project.id);
  });
  // Inventory includes citations on relevant claims even when the source has no project link.
  const sourceIds = new Set(relevant.filter((r) => r.kind === "source").map((r) => r.id));
  for (const r of [project, ...relevant]) {
    for (const source of evidence(co, r).sources) {
      if (source.kind === "source" && !source.archived && !records.isLegacy(co, source.id)) sourceIds.add(source.id);
    }
  }
  const sources = [...sourceIds]
    .map((id) => records.need(co, id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.key.localeCompare(b.key));
  const section = (kind: string) =>
    relevant
      .filter((r) => r.kind === kind)
      .slice(-limit)
      .map((r) => evidence(co, r));
  const relatedIds = new Set([project.id, ...relevant.map((r) => r.id)]);
  const findings = co
    .all<{ id: string }>(
      `select id from records where kind = 'flag' and archived = 0
      and json_extract(body, '$.status') = 'open'
      and id not in (select record_id from legacy_records) order by created_at, key`,
    )
    .map((x) => records.need(co, x.id))
    .filter(
      (r) =>
        relatedIds.has(String(r.body.about_id)) ||
        (Array.isArray(r.body.evidence_ids) &&
          r.body.evidence_ids.some(
            (id) => typeof id === "string" && relatedIds.has(id),
          )),
    );
  return {
    project: evidence(co, project),
    scope_conflicts: scopeConflicts.slice(-limit).map((r) => evidence(co, r)),
    facts: section("fact"),
    knowledge: section("knowledge"),
    log: section("entry"),
    issues: section("issue_note"),
    decisions: section("decision"),
    sources: sources.slice(-limit).map((r) => evidence(co, r)),
    findings: findings.slice(-limit).map((r) => evidence(co, r)),
    truncated:
      findings.length > limit ||
      scopeConflicts.length > limit ||
      sources.length > limit ||
      ["fact", "knowledge", "entry", "issue_note", "decision", "source"].some(
        (k) => relevant.filter((r) => r.kind === k).length > limit,
      ),
    scope:
      "Facts/knowledge may be deliberately shared by project links. Journal uses one canonical project; conflicting historical entries are flagged separately.",
  };
}
export type ProjectContext = ReturnType<typeof projectContext>;
