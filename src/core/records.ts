// Records of one company: the current version, every past version, links between records, and search.
// Nothing here deletes. Every change adds one row to `revisions`, in the same transaction as the change.
import { randomBytes } from "node:crypto";
import { type Role } from "./agents.ts";
import type { Company } from "./company.ts";
import { conflict, forbidden, invalid, notFound } from "./errors.ts";
import { getKind } from "./kinds.ts";
import { BUILTIN_KINDS, ENTRY_TYPES, type EntryType, type KindDef } from "./schema.ts";

export type Body = Record<string, unknown>;
export type Rec = {
  id: string;
  key: string;
  kind: string;
  rev: number;
  body: Body;
  archived: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string;
};
export type Revision = {
  seq: number;
  record_id: string;
  key: string;
  kind: string;
  rev: number;
  body: Body;
  archived: boolean;
  changed: string[];
  op: string;
  op_id: string | null;
  actor: string;
  actor_kind: string;
  at: string;
  why: string | null;
};
/** Who is writing. Stored on every revision. */
export type Who = { name: string; kind: string; role?: Role };
export type WriteMeta = { why?: string | undefined; opId?: string | undefined };

type RecRow = Omit<Rec, "body" | "archived"> & { body: string; archived: number };
type RevRow = Omit<Revision, "body" | "archived" | "changed"> & { body: string; archived: number; changed: string };

const toRec = (r: RecRow): Rec => ({ ...r, body: JSON.parse(r.body) as Body, archived: r.archived === 1 });
const toRev = (r: RevRow): Revision => ({
  ...r,
  body: JSON.parse(r.body) as Body,
  archived: r.archived === 1,
  changed: JSON.parse(r.changed) as string[],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_IN_TEXT = /\b[A-Z]{2,6}-N?\d{3,}\b/g;

export function uuidv7(): string {
  const b = randomBytes(16);
  let t = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(t & 255n);
    t >>= 8n;
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** JSON text that is the same for equal values whatever the key order. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function changedFields(before: Body, after: Body): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => stable(before[k]) !== stable(after[k])).sort();
}

// ---- Reads ----

/** A record by id or key (TSK-0007). */
export function get(co: Company, ref: string): Rec | undefined {
  const r = co.one<RecRow>("select * from records where id = ? or key = ?", ref.toLowerCase(), ref.toUpperCase());
  return r ? toRec(r) : undefined;
}

export function need(co: Company, ref: string): Rec {
  const r = get(co, ref);
  if (!r) throw notFound(`record ${ref}`);
  return r;
}

export type ListOptions = {
  kind?: string | undefined;
  status?: string | undefined;
  archived?: boolean | "all" | undefined;
  limit?: number | undefined;
  /** Top-level body fields that must equal these values. */
  where?: Record<string, string | number | boolean> | undefined;
  /** Only records changed at or after this time (ISO). */
  since?: string | undefined;
};

/** Newest first. Live records only unless `archived` says otherwise. */
export function list(co: Company, o: ListOptions = {}): Rec[] {
  const where: string[] = ["id not in (select record_id from legacy_records)"];
  const params: (string | number)[] = [];
  if (o.kind) {
    where.push("kind = ?");
    params.push(o.kind);
  }
  if (o.status) {
    where.push("json_extract(body, '$.status') = ?");
    params.push(o.status);
  }
  if (o.archived !== "all") {
    where.push("archived = ?");
    params.push(o.archived ? 1 : 0);
  }
  if (o.since) {
    where.push("updated_at >= ?");
    params.push(o.since);
  }
  for (const [field, value] of Object.entries(o.where ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw invalid(`bad field name: ${field}`);
    where.push(`json_extract(body, '$.${field}') = ?`);
    params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  params.push(Math.min(Math.max(o.limit ?? 100, 1), 1000));
  return co
    .all<RecRow>(
      `select * from records ${where.length ? `where ${where.join(" and ")}` : ""} order by updated_at desc, key desc limit ?`,
      ...params,
    )
    .map(toRec);
}

export type Hit = { id: string; key: string; kind: string; title: string; snippet: string };

/**
 * Full-text search: every word must appear (a word also matches longer words that start with it). Best match first.
 * Retired records are available by their keys in the legacy archive.
 */
export function search(co: Company, q: string, o: { kind?: string | undefined; limit?: number | undefined } = {}): Hit[] {
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return [];
  const match = words.map((w) => `"${w}"*`).join(" ");
  return co.all<Hit>(
    `select r.id, r.key, r.kind, f.title, snippet(records_fts, 3, '[', ']', ' … ', 16) as snippet
     from records_fts f join records r on r.id = f.id
     where records_fts match ? and r.archived = 0 and r.id not in (select record_id from legacy_records)
       and (? is null or r.kind = ?)
     order by bm25(records_fts, 0, 8.0, 4.0, 1.0) limit ?`,
    match,
    o.kind ? o.kind : null,
    o.kind ? o.kind : null,
    Math.min(Math.max(o.limit ?? 20, 1), 200),
  );
}

const REV_COLUMNS =
  "v.seq, v.record_id, r.key, r.kind, v.rev, v.body, v.archived, v.changed, v.op, v.op_id, v.actor, v.actor_kind, v.at, v.why";

/** Every version of a record, oldest first. */
export function history(co: Company, ref: string): Revision[] {
  const r = need(co, ref);
  return co
    .all<RevRow>(`select ${REV_COLUMNS} from revisions v join records r on r.id = v.record_id where v.record_id = ? order by v.rev`, r.id)
    .map(toRev);
}

/** The company's change feed: revisions with seq > since, oldest first. */
export function changes(co: Company, since: number, limit = 200): Revision[] {
  return co
    .all<RevRow>(
      `select ${REV_COLUMNS} from revisions v join records r on r.id = v.record_id where v.seq > ? order by v.seq limit ?`,
      since,
      Math.min(Math.max(limit, 1), 5000),
    )
    .map(toRev);
}

export type Link = { key: string; kind: string; title: string; label: string; archived: boolean };

/** What a record points at (`out`) and what points at it (`in`). */
export function links(co: Company, ref: string): { out: Link[]; in: Link[] } {
  const r = need(co, ref);
  const q = (mine: "from_id" | "to_id", other: "from_id" | "to_id") =>
    co
      .all<{ key: string; kind: string; title: string | null; label: string; archived: number }>(
        `select r.key, r.kind, f.title, l.label, r.archived from links l join records r on r.id = l.${other}
       left join records_fts f on f.id = r.id where l.${mine} = ? order by l.label, r.key`,
        r.id,
      )
      .map((x) => ({ key: x.key, kind: x.kind, title: x.title ?? x.key, label: x.label, archived: x.archived === 1 }));
  return { out: q("from_id", "to_id"), in: q("to_id", "from_id") };
}

/** A Journal belongs to one project. About/citations do not grant additional project membership. */
export function projectScope(co: Company, r: Pick<Rec, "kind" | "body">) {
  const project = (ref: unknown) => {
    const target = typeof ref === "string" ? get(co, ref) : undefined;
    return target?.kind === "project" ? target.id : null;
  };
  const declared = project(r.body.project_id);
  const about = r.kind === "entry" && typeof r.body.about_id === "string" ? get(co, r.body.about_id) : undefined;
  const inherited = about?.kind === "project" ? about.id : project(about?.body.project_id);
  const problem = r.body.project_id && !declared ? "Unknown historical project reference" :
    declared && inherited && declared !== inherited ? "Conflicting historical about/project references" : null;
  return { project_id: problem ? null : declared ?? inherited, declared, inherited, problem };
}

/** Current assertion, original record and last edit are distinct facts in append-only history. */
export function provenance(co: Company, r: Rec) {
  const versions = history(co, r.id);
  const first = versions[0]!;
  const last = versions.at(-1)!;
  const fields = r.kind === "fact" ? ["subject", "predicate", "value_type", "value", "scope", "unit", "observed_at", "project_id"] :
    r.kind === "knowledge" ? ["body", "text", "project_id", ...(!r.body.body && !r.body.text ? ["title"] : [])] :
    r.kind === "entry" ? ["type", "title", "detail", "text", "about_id", "project_id"] : null;
  const changedLast = (wanted: string[] | null) => wanted === null ? last : versions.reduce((assertion, v, i) =>
    i === 0 || wanted.some((field) => stable(versions[i - 1]!.body[field]) !== stable(v.body[field])) ? v : assertion, first);
  const stamp = (v: Revision) => ({ actor: v.actor, actor_kind: v.actor_kind, at: v.at, rev: v.rev, why: v.why });
  return {
    provenance: stamp(changedLast(fields)),
    last_edited: stamp(last),
    citation_provenance: stamp(changedLast(["source", "source_ids", "url"])),
    original: { ...stamp(first), body: first.body },
  };
}

/** SQL creation order, with canonical scope filtering before any pagination cap. */
export function journalRecords(co: Company, o: { type?: string | undefined; since?: string | undefined; project?: string | undefined; limit?: number | null | undefined } = {}): Rec[] {
  const filters = ["kind = 'entry'", "archived = 0", "id not in (select record_id from legacy_records)"];
  const args: (string | number)[] = [];
  if (o.type) { filters.push("json_extract(body, '$.type') = ?"); args.push(o.type); }
  if (o.since) { filters.push("created_at >= ?"); args.push(o.since); }
  const project = o.project ? need(co, o.project).id : null;
  const limit = o.limit === undefined ? 50 : o.limit;
  // Historical rows may lack project_id or conflict with about_id. Resolve with the same core invariant
  // as writes; no limit is applied before this filter and no stored historical row is rewritten.
  const rows = co.all<{ id: string }>(`select id from records where ${filters.join(" and ")} order by created_at desc, key desc`, ...args)
    .map(({ id }) => need(co, id)).filter((r) => !project || projectScope(co, r).project_id === project);
  return limit === null ? rows : rows.slice(0, limit);
}

// ---- Writes ----

export const isLegacy = (co: Company, ref: string): boolean =>
  !!co.one("select 1 from legacy_records where record_id = ?", need(co, ref).id);
/** A citation is author-provided evidence, never independent verification. */
export function hasCurrentSource(co: Company, body: Body): boolean {
  return (
    !!(typeof body.source === "string" && body.source.trim()) ||
    (Array.isArray(body.source_ids) &&
      body.source_ids.some((id) => {
        const source = typeof id === "string" ? get(co, id) : undefined;
        return source?.kind === "source" && !source.archived && !isLegacy(co, source.id);
      }))
  );
}
function writable(co: Company, who: Who, r?: Rec): void {
  if (who.role === "viewer") throw forbidden("writing needs the member role");
  if (who.kind === "curator" && r) throw forbidden("Curator never edits claims or existing records");
  if (r && isLegacy(co, r.id)) throw forbidden(`${r.key} is in the read-only legacy archive; upgrade clients to 0.4.0`);
}

function nextKey(co: Company, prefix: string): string {
  const n = co.one<{ next_n: number }>("select next_n from key_counters where prefix = ?", prefix)?.next_n ?? 1;
  co.run(
    "insert into key_counters (prefix, next_n) values (?, ?) on conflict (prefix) do update set next_n = excluded.next_n",
    prefix,
    n + 1,
  );
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/**
 * Check a body against its kind and return it with references stored as record ids.
 * A reference may be given as a key (PRJ-0003) or an id. Only fields that changed are checked,
 * so an imported record that breaks today's rules, or points at a since-archived record, can still be edited.
 */
function checked(co: Company, kind: KindDef, body: Body, prev: Body | null): Body {
  const touched = (field: string) => !prev || stable(prev[field]) !== stable(body[field]);
  const title = body[kind.title_field];
  if (touched(kind.title_field) && (typeof title !== "string" || !title.trim())) throw invalid(`${kind.kind} needs a ${kind.title_field}`);
  const status = body.status;
  if (
    touched("status") &&
    kind.statuses &&
    status !== undefined &&
    status !== null &&
    (typeof status !== "string" || !kind.statuses.includes(status))
  )
    throw invalid(`status must be one of ${kind.statuses.join(", ")}`);
  for (const field of ["owner", "assignment_id", "work_order_id", "verification", "verified_by", "permissions", "heartbeat", "dispatch"]) {
    if (body[field] !== undefined && touched(field))
      throw invalid(`${field} is retired; planning notes are unassigned and provenance is server-attributed`);
  }
  if (kind.kind === "entry" && touched("type") && body.type !== undefined && !ENTRY_TYPES.includes(body.type as EntryType))
    throw invalid("log type must be outcome, learning or note");
  if (kind.kind === "entry" && body.type === "learning" && !hasCurrentSource(co, body))
    throw invalid("Learning needs a source citation or current source_ids; citations are not independent verification");
  if (kind.kind === "project") {
    for (const field of ["goal", "current_state"])
      if (touched(field) && body[field] !== undefined && typeof body[field] !== "string") throw invalid(`${field} must be text`);
    if (
      touched("objectives") &&
      body.objectives !== undefined &&
      (!Array.isArray(body.objectives) || !body.objectives.every((x) => typeof x === "string"))
    )
      throw invalid("objectives must be an array of text");
  }
  if (kind.kind === "fact") {
    for (const field of ["subject", "predicate"])
      if (typeof body[field] !== "string" || !body[field].trim()) throw invalid(`fact needs ${field}`);
    const types: Record<string, string> = { text: "string", number: "number", boolean: "boolean" };
    if (
      !types[String(body.value_type)] ||
      typeof body.value !== types[String(body.value_type)] ||
      (typeof body.value === "number" && !Number.isFinite(body.value))
    )
      throw invalid("fact value must match value_type: text, number or boolean");
    for (const field of ["scope", "unit", "source", "observed_at"])
      if (body[field] !== undefined && typeof body[field] !== "string") throw invalid(`${field} must be text`);
    if (body.observed_at !== undefined && !Number.isFinite(Date.parse(String(body.observed_at))))
      throw invalid("observed_at must be a date");
  }
  const out: Body = { ...body };
  const resolve = (field: string, value: unknown): unknown => {
    if (typeof value !== "string" || !value) return value;
    const declared = field in kind.refs || field.replace(/_ids$/, "_id") in kind.refs;
    const target = get(co, value);
    if (!target) {
      if (declared) throw invalid(`${field}: no record ${value} in this company`);
      return value; // an id of something that is not a record here (a conversation, an outside system)
    }
    if (declared) {
      const want = kind.refs[field] ?? kind.refs[field.replace(/_ids$/, "_id")] ?? null;
      if (want && target.kind !== want) throw invalid(`${field} must point at a ${want}, ${target.key} is a ${target.kind}`);
      if (isLegacy(co, target.id)) throw invalid(`${field}: ${target.key} is in the legacy archive`);
      if (target.archived) throw invalid(`${field}: ${target.key} is archived`);
    }
    return target.id;
  };
  for (const [field, value] of Object.entries(body)) {
    if (prev && stable(prev[field]) === stable(value)) continue;
    if (field in kind.refs && value !== null && value !== undefined) {
      if (
        field.endsWith("_ids")
          ? !Array.isArray(value) || !value.every((v) => typeof v === "string" && v)
          : typeof value !== "string" || !value
      )
        throw invalid(`${field}: expected record reference${field.endsWith("_ids") ? " array" : ""}`);
    }
    if (field.endsWith("_id")) out[field] = resolve(field, value);
    else if (field.endsWith("_ids") && Array.isArray(value)) out[field] = value.map((v) => resolve(field, v));
  }
  if (kind.kind === "entry") {
    if (prev) {
      // Scope anchors are fixed at creation, including absent or historical anchors.
      // Undo uses this same validation; archive/restore never changes the body.
      for (const field of ["project_id", "about_id"])
        if (stable(prev[field]) !== stable(out[field]))
          throw invalid(`Journal ${field} is immutable after creation; append a new attributed correction entry`);
    } else {
      const scope = projectScope(co, { kind: "entry", body: out });
      if (scope.problem) throw invalid("Journal about/project references must identify the same project");
      if (!out.project_id && scope.inherited) {
        const project = need(co, scope.inherited);
        if (project.archived || isLegacy(co, project.id)) throw invalid("Journal project is archived or legacy");
        out.project_id = scope.inherited;
      }
    }
  }
  return out;
}

/** The words of a body, for search and for finding cited keys. Bookkeeping (`_source`...) and bare ids are left out. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") {
    if (!UUID.test(v)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) strings(x, out);
  return out;
}

/** Rebuild the record's search entry and its outgoing links from its body. */
export function index(co: Company, r: Rec, kind: KindDef): void {
  const text = strings(r.body);
  co.run("delete from records_fts where id = ?", r.id);
  co.run(
    "insert into records_fts (id, key, title, body) values (?, ?, ?, ?)",
    r.id,
    r.key,
    String(r.body[kind.title_field] ?? r.key),
    text.join("\n"),
  );
  co.run("delete from links where from_id = ?", r.id);
  const add = (to: string | undefined, label: string) => {
    if (to && to !== r.id) co.run("insert or ignore into links (from_id, to_id, label) values (?, ?, ?)", r.id, to, label);
  };
  const idOf = (v: unknown) =>
    typeof v === "string" && UUID.test(v) ? co.one<{ id: string }>("select id from records where id = ?", v)?.id : undefined;
  for (const [field, value] of Object.entries(r.body)) {
    if (field.endsWith("_id")) add(idOf(value), field.slice(0, -3));
    else if (field.endsWith("_ids") && Array.isArray(value)) for (const v of value) add(idOf(v), field.slice(0, -4));
  }
  for (const key of new Set(text.flatMap((s) => s.match(KEY_IN_TEXT) ?? [])))
    add(co.one<{ id: string }>("select id from records where key = ?", key)?.id, "cites");
}

function store(co: Company, r: Rec, kind: KindDef, op: string, changed: string[], who: Who, m: WriteMeta, fresh: boolean): Rec {
  const body = JSON.stringify(r.body);
  if (fresh)
    co.run(
      "insert into records (id, key, kind, rev, body, archived, created_at, updated_at, updated_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.id,
      r.key,
      r.kind,
      r.rev,
      body,
      r.archived ? 1 : 0,
      r.created_at,
      r.updated_at,
      r.updated_by,
    );
  else
    co.run(
      "update records set rev = ?, body = ?, archived = ?, updated_at = ?, updated_by = ? where id = ?",
      r.rev,
      body,
      r.archived ? 1 : 0,
      r.updated_at,
      r.updated_by,
      r.id,
    );
  co.run(
    "insert into revisions (record_id, rev, body, archived, changed, op, op_id, actor, actor_kind, at, why) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    r.id,
    r.rev,
    body,
    r.archived ? 1 : 0,
    JSON.stringify(changed),
    op,
    m.opId ?? null,
    who.name,
    who.kind,
    r.updated_at,
    m.why ?? null,
  );
  index(co, r, kind);
  return r;
}

export function create(co: Company, who: Who, kindName: string, body: Body, m: WriteMeta = {}): Rec {
  return co.tx(() => {
    const kind = getKind(co, kindName);
    if (!kind) throw invalid(`unknown kind: ${kindName}`);
    writable(co, who);
    if (who.kind === "curator" && !["flag", "briefing"].includes(kind.kind)) throw forbidden("Curator can only flag and suggest");
    if (!BUILTIN_KINDS.some((k) => k.kind === kind.kind))
      throw forbidden(`${kind.kind} was retired in 0.4.0; use project, fact, knowledge, log or issue notes`);
    const clean = checked(co, kind, body, null);
    const at = new Date().toISOString();
    const r: Rec = {
      id: uuidv7(),
      key: nextKey(co, kind.prefix),
      kind: kind.kind,
      rev: 1,
      body: clean,
      archived: false,
      created_at: at,
      updated_at: at,
      updated_by: who.name,
    };
    store(co, r, kind, "create", changedFields({}, clean), who, m, true);
    return r;
  });
}

/**
 * Set fields on a record. A field set to null is removed. With `baseRev`, the write is refused when the
 * record has moved on since that revision. A patch that changes nothing writes nothing.
 */
export function patch(co: Company, who: Who, ref: string, set: Body, m: WriteMeta & { baseRev?: number | undefined } = {}): Rec {
  return co.tx(() => {
    const cur = need(co, ref);
    writable(co, who, cur);
    const normalized = set;
    if (m.baseRev !== undefined && m.baseRev !== cur.rev)
      throw conflict(`${cur.key} is at revision ${cur.rev}, not ${m.baseRev}: read it again`);
    const kind = getKind(co, cur.kind)!;
    const next: Body = { ...cur.body };
    for (const [k, v] of Object.entries(normalized)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    const clean = checked(co, kind, next, cur.body);
    if (cur.kind !== "entry" && "project_id" in kind.refs && stable(cur.body.project_id) !== stable(clean.project_id)) {
      const nextProject = projectScope(co, { kind: cur.kind, body: clean }).project_id;
      const dependents = co.all<{ id: string }>("select id from records where kind = 'entry' and id not in (select record_id from legacy_records) and json_extract(body, '$.about_id') in (?, ?)", cur.id, cur.key);
      for (const { id } of dependents) {
        const entry = need(co, id);
        const declared = projectScope(co, entry).declared;
        if (declared && nextProject && declared !== nextProject)
          throw invalid(`${cur.key}: project change conflicts with Journal ${entry.key}; append a corrected claim and Journal entry instead`);
      }
    }
    const changed = changedFields(cur.body, clean);
    if (!changed.length) return cur;
    const r: Rec = { ...cur, rev: cur.rev + 1, body: clean, updated_at: new Date().toISOString(), updated_by: who.name };
    return store(co, r, kind, "patch", changed, who, m, false);
  });
}

/** Archive a record, or bring it back with `archived = false`. Nothing is ever deleted. */
export function setArchived(co: Company, who: Who, ref: string, archived: boolean, m: WriteMeta = {}): Rec {
  return co.tx(() => {
    const cur = need(co, ref);
    writable(co, who, cur);
    if (cur.archived === archived) return cur;
    const r: Rec = { ...cur, rev: cur.rev + 1, archived, updated_at: new Date().toISOString(), updated_by: who.name };
    return store(co, r, getKind(co, cur.kind)!, archived ? "archive" : "restore", ["archived"], who, m, false);
  });
}

/** The record's display line: its kind's title field, else its key. */
export function titleOf(co: Company, r: Rec): string {
  const t = r.body[getKind(co, r.kind)?.title_field ?? "title"];
  return typeof t === "string" && t.trim() ? t : r.key;
}

/**
 * Write a Journal entry: what happened. `about` is the record it is about, when there is one; the entry
 * joins that record's project (or the record itself when it is a project).
 */
export function logEntry(
  co: Company,
  who: Who,
  type: EntryType,
  text: string,
  about: Rec | null,
  m: WriteMeta = {},
  extra: Body = {},
): Rec {
  const body: Body = { type, title: text.trim().slice(0, 300), ...extra };
  if (about) body.about_id = about.id;
  return create(co, who, "entry", body, m);
}
