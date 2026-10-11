// Focused project context and evidence. No task selection or runtime instructions.
import type { Company } from "./company.ts";
import { invalid } from "./errors.ts";
import * as records from "./records.ts";

export function evidence(co: Company, r: records.Rec) {
  const last = records.history(co, r.id).at(-1)!;
  const sourceIds = Array.isArray(r.body.source_ids) ? r.body.source_ids : [];
  return {
    record: r,
    provenance: {
      actor: last.actor,
      actor_kind: last.actor_kind,
      at: last.at,
      rev: last.rev,
      why: last.why,
    },
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
  const relevant = ids.map((x) => records.need(co, x.id));
  const section = (kind: string) =>
    relevant
      .filter((r) => r.kind === kind)
      .slice(-limit)
      .map((r) => evidence(co, r));
  const relatedIds = new Set([project.id, ...ids.map((x) => x.id)]);
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
    facts: section("fact"),
    knowledge: section("knowledge"),
    log: section("entry"),
    issues: section("issue"),
    decisions: section("decision"),
    sources: section("source"),
    findings: findings.slice(-limit).map((r) => evidence(co, r)),
    truncated:
      findings.length > limit ||
      ["fact", "knowledge", "entry", "issue", "decision", "source"].some(
        (k) => relevant.filter((r) => r.kind === k).length > limit,
      ),
    scope:
      "Explicit project links and citations only; use search for other company knowledge.",
  };
}
export type ProjectContext = ReturnType<typeof projectContext>;
