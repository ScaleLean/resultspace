// Record kinds are rows in the company's file. A company's own kinds are its data, not code.
import type { Company } from "./company.ts";
import { invalid } from "./errors.ts";
import { canonicalKind, LEGACY_KINDS, LEGACY_PREFIXES, type KindDef } from "./schema.ts";

type KindRow = { kind: string; prefix: string; title_field: string; statuses: string | null; refs: string };

const fromRow = (r: KindRow): KindDef => ({
  kind: r.kind,
  prefix: r.prefix,
  title_field: r.title_field,
  statuses: r.statuses ? (JSON.parse(r.statuses) as string[]) : null,
  refs: JSON.parse(r.refs) as Record<string, string | null>,
});

export function listKinds(co: Company): KindDef[] {
  return co.all<KindRow>("select * from kinds order by kind").map(fromRow);
}

/** A kind by name. An old name (`work_order`) finds the kind it became (`assignment`). */
export function getKind(co: Company, kind: string): KindDef | undefined {
  const r = co.one<KindRow>("select * from kinds where kind = ?", canonicalKind(kind));
  return r ? fromRow(r) : undefined;
}

export type KindInput = { kind: string; prefix: string; title_field?: string; statuses?: string[] | null; refs?: Record<string, string | null> };

/** Add a kind, or change an existing kind's title field, statuses and reference fields. A prefix never changes. */
export function defineKind(co: Company, k: KindInput): KindDef {
  if (!/^[a-z][a-z_]{0,40}$/.test(k.kind)) throw invalid(`bad kind name: ${k.kind}`);
  if (!/^[A-Z]{2,6}$/.test(k.prefix)) throw invalid(`bad key prefix: ${k.prefix} (2-6 capital letters)`);
  if (LEGACY_KINDS[k.kind]) throw invalid(`${k.kind} is the old name of ${LEGACY_KINDS[k.kind]}: use that`);
  if (LEGACY_PREFIXES.includes(k.prefix)) throw invalid(`prefix ${k.prefix} is kept for keys made before it was renamed`);
  return co.tx(() => {
    const cur = getKind(co, k.kind);
    if (cur && cur.prefix !== k.prefix) throw invalid(`${k.kind} already uses prefix ${cur.prefix}`);
    const taken = co.one<{ kind: string }>("select kind from kinds where prefix = ? and kind <> ?", k.prefix, k.kind);
    if (taken) throw invalid(`prefix ${k.prefix} belongs to ${taken.kind}`);
    const refs = k.refs ?? cur?.refs ?? {};
    for (const [field, target] of Object.entries(refs)) {
      if (!/_ids?$/.test(field)) throw invalid(`reference field ${field} must end in _id or _ids`);
      if (target !== null && target !== k.kind && !getKind(co, target)) throw invalid(`reference field ${field} points at unknown kind ${target}`);
    }
    const statuses = k.statuses === undefined ? (cur?.statuses ?? null) : k.statuses;
    co.run(
      `insert into kinds (kind, prefix, title_field, statuses, refs) values (?, ?, ?, ?, ?)
       on conflict (kind) do update set title_field = excluded.title_field, statuses = excluded.statuses, refs = excluded.refs`,
      k.kind, k.prefix, k.title_field ?? cur?.title_field ?? "title", statuses ? JSON.stringify(statuses) : null, JSON.stringify(refs),
    );
    return getKind(co, k.kind)!;
  });
}
