// Record kinds are rows in the company's file. A company's own kinds are its data, not code.
import type { Company } from "./company.ts";
import { BUILTIN_KINDS, type KindDef } from "./schema.ts";

type KindRow = { kind: string; prefix: string; title_field: string; statuses: string | null; refs: string };

const fromRow = (r: KindRow): KindDef => ({
  kind: r.kind,
  prefix: r.prefix,
  title_field: r.title_field,
  statuses: r.statuses ? (JSON.parse(r.statuses) as string[]) : null,
  refs: JSON.parse(r.refs) as Record<string, string | null>,
});

export function listKinds(co: Company): KindDef[] {
  return co
    .all<KindRow>("select * from kinds order by kind")
    .filter((k) => BUILTIN_KINDS.some((b) => b.kind === k.kind))
    .map(fromRow);
}

/** Historical kinds remain readable, but only built-ins are writable. */
export function getKind(co: Company, kind: string): KindDef | undefined {
  const r = co.one<KindRow>("select * from kinds where kind = ?", kind);
  return r ? fromRow(r) : undefined;
}
