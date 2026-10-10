// Records of one company: the current version, every past version, links between records, and search.
// Nothing here deletes. Every change adds one row to `revisions`, in the same transaction as the change.
import { randomBytes } from "node:crypto";
import { listAgents, type Role } from "./agents.ts";
import type { Company } from "./company.ts";
import { conflict, forbidden, invalid, notFound } from "./errors.ts";
import { getKind } from "./kinds.ts";
import { canonicalKind, LEGACY_FIELDS, type EntryType, type KindDef } from "./schema.ts";

export type Body = Record<string, unknown>;
export type Rec = {
  id: string; key: string; kind: string; rev: number; body: Body; archived: boolean;
  created_at: string; updated_at: string; updated_by: string;
};
export type Revision = {
  seq: number; record_id: string; key: string; kind: string; rev: number; body: Body; archived: boolean;
  changed: string[]; op: string; op_id: string | null; actor: string; actor_kind: string; at: string; why: string | null;
};
/** Who is writing. Stored on every revision. */
export type Who = { name: string; kind: string; role?: Role };
export type WriteMeta = { why?: string | undefined; opId?: string | undefined };

type RecRow = Omit<Rec, "body" | "archived"> & { body: string; archived: number };
type RevRow = Omit<Revision, "body" | "archived" | "changed"> & { body: string; archived: number; changed: string };

const toRec = (r: RecRow): Rec => ({ ...r, body: JSON.parse(r.body) as Body, archived: r.archived === 1 });
const toRev = (r: RevRow): Revision => ({ ...r, body: JSON.parse(r.body) as Body, archived: r.archived === 1, changed: JSON.parse(r.changed) as string[] });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_IN_TEXT = /\b[A-Z]{2,6}-N?\d{3,}\b/g;

export function uuidv7(): string {
  const b = randomBytes(16);
  let t = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) { b[i] = Number(t & 255n); t >>= 8n; }
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
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function changedFields(before: Body, after: Body): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => stable(before[k]) !== stable(after[k])).sort();
}

/**
 * A body with old field names (`work_order_id`) under their new names (`assignment_id`). Giving both with
 * different values is refused. Used on every write, and on `where` filters, so old callers keep working.
 */
export function modernFields<T extends Body>(body: T): T {
  let out: Body = body;
  for (const [old, now] of Object.entries(LEGACY_FIELDS)) {
    if (!(old in out)) continue;
    if (now in out && stable(out[now]) !== stable(out[old])) throw invalid(`${old} is the old name of ${now}: give one of them`);
    const { [old]: value, ...rest } = out;
    out = { ...rest, [now]: value };
  }
  return out as T;
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
  kind?: string | undefined; status?: string | undefined; archived?: boolean | "all" | undefined; limit?: number | undefined;
  /** Top-level body fields that must equal these values. */
  where?: Record<string, string | number | boolean> | undefined;
  /** Only records changed at or after this time (ISO). */
  since?: string | undefined;
};

/** Newest first. Live records only unless `archived` says otherwise. */
export function list(co: Company, o: ListOptions = {}): Rec[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (o.kind) { where.push("kind = ?"); params.push(canonicalKind(o.kind)); }
  if (o.status) { where.push("json_extract(body, '$.status') = ?"); params.push(o.status); }
  if (o.archived !== "all") { where.push("archived = ?"); params.push(o.archived ? 1 : 0); }
  if (o.since) { where.push("updated_at >= ?"); params.push(o.since); }
  for (const [field, value] of Object.entries(modernFields(o.where ?? {}))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw invalid(`bad field name: ${field}`);
    where.push(`json_extract(body, '$.${field}') = ?`);
    params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  params.push(Math.min(Math.max(o.limit ?? 100, 1), 1000));
  return co.all<RecRow>(`select * from records ${where.length ? `where ${where.join(" and ")}` : ""} order by updated_at desc, key desc limit ?`, ...params).map(toRec);
}

export type Hit = { id: string; key: string; kind: string; title: string; snippet: string };

/**
 * Full-text search: every word must appear (a word also matches longer words that start with it). Best match first.
 * Session entries and old jobs are left out unless asked for by kind: they are noise in an answer.
 */
export function search(co: Company, q: string, o: { kind?: string | undefined; limit?: number | undefined } = {}): Hit[] {
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return [];
  const match = words.map((w) => `"${w}"*`).join(" ");
  return co.all<Hit>(
    `select r.id, r.key, r.kind, f.title, snippet(records_fts, 3, '[', ']', ' … ', 16) as snippet
     from records_fts f join records r on r.id = f.id
     where records_fts match ? and r.archived = 0
       and (case when ? is null then r.kind <> 'job' and not (r.kind = 'entry' and coalesce(json_extract(r.body, '$.type'), '') = 'session') else r.kind = ? end)
     order by bm25(records_fts, 0, 8.0, 4.0, 1.0) limit ?`,
    match, o.kind ? canonicalKind(o.kind) : null, o.kind ? canonicalKind(o.kind) : null, Math.min(Math.max(o.limit ?? 20, 1), 200),
  );
}

const REV_COLUMNS = "v.seq, v.record_id, r.key, r.kind, v.rev, v.body, v.archived, v.changed, v.op, v.op_id, v.actor, v.actor_kind, v.at, v.why";

/** Every version of a record, oldest first. */
export function history(co: Company, ref: string): Revision[] {
  const r = need(co, ref);
  return co.all<RevRow>(`select ${REV_COLUMNS} from revisions v join records r on r.id = v.record_id where v.record_id = ? order by v.rev`, r.id).map(toRev);
}

/** The company's change feed: revisions with seq > since, oldest first. */
export function changes(co: Company, since: number, limit = 200): Revision[] {
  return co.all<RevRow>(
    `select ${REV_COLUMNS} from revisions v join records r on r.id = v.record_id where v.seq > ? order by v.seq limit ?`,
    since, Math.min(Math.max(limit, 1), 5000),
  ).map(toRev);
}

export type Link = { key: string; kind: string; title: string; label: string; archived: boolean };

/** What a record points at (`out`) and what points at it (`in`). */
export function links(co: Company, ref: string): { out: Link[]; in: Link[] } {
  const r = need(co, ref);
  const q = (mine: "from_id" | "to_id", other: "from_id" | "to_id") =>
    co.all<{ key: string; kind: string; title: string | null; label: string; archived: number }>(
      `select r.key, r.kind, f.title, l.label, r.archived from links l join records r on r.id = l.${other}
       left join records_fts f on f.id = r.id where l.${mine} = ? order by l.label, r.key`,
      r.id,
    ).map((x) => ({ key: x.key, kind: x.kind, title: x.title ?? x.key, label: x.label, archived: x.archived === 1 }));
  return { out: q("from_id", "to_id"), in: q("to_id", "from_id") };
}

// ---- Writes ----

// Generic writes deliberately accept only assignment metadata. Lifecycle handlers have a separate
// internal entry point; neither operation input nor WriteMeta can opt into that path.
const ASSIGNMENT_METADATA = new Set(["title", "brief", "due_on", "project_id", "owner"]);

function assignmentOwner(co: Company, body: Body): void {
  const owner = body.owner;
  if (typeof owner !== "string" || !owner) throw invalid("an assignment needs an owner (an agent's name)");
  if (owner !== "curator" && !listAgents(co).some((a) => a.name === owner && a.active)) throw invalid(`no active agent ${owner} in this company`);
}

function assignmentWriter(who: Who, cur: Rec): void {
  if (who.role === "viewer" || (cur.body.owner !== who.name && who.role !== "admin"))
    throw forbidden(`${cur.key} belongs to ${String(cur.body.owner)}`);
}

// Tasks have direct authority only. Entries retain their own authority in server-owned metadata;
// about-links never transfer authority back onto the referenced shared record.
function directAssignment(co: Company, body: Body): Rec | undefined {
  const resolve = (ref: unknown): Rec | undefined => {
    if (ref === undefined || ref === null || ref === "") return;
    const target = typeof ref === "string" ? get(co, ref) : undefined;
    if (!target || target.kind !== "assignment") throw forbidden("cannot resolve assignment evidence authority");
    return target;
  };
  const assignment = resolve(body.assignment_id);
  const legacy = resolve(body.work_order_id);
  if (assignment && legacy && assignment.id !== legacy.id)
    throw invalid("work_order_id is the old name of assignment_id: give one of them");
  return assignment ?? legacy;
}

function evidenceAssignments(co: Company, body: Body): string[] {
  const ids: string[] = [];
  const direct = directAssignment(co, body);
  if (direct) ids.push(direct.id);
  if (body.type === "outcome" && typeof body.about_id === "string") {
    const about = get(co, body.about_id);
    if (about?.kind === "assignment") ids.push(about.id);
    else if (about) {
      const linked = directAssignment(co, about.body);
      if (linked) ids.push(linked.id);
    }
  }
  return ids;
}

function entryAuthority(co: Company, cur: Rec): string[] {
  const cached = co.one<{ assignment_ids: string }>("select assignment_ids from evidence_authority where record_id = ?", cur.id);
  if (cached) return JSON.parse(cached.assignment_ids) as string[];
  // One-time legacy initialization. A link lasts until the next association change, including
  // a detached/null revision; repeated links must never bridge those gaps.
  const ids: string[] = [];
  const history = co.all<Body & { seq: number }>(`select seq,
    json_extract(body, '$.assignment_id') as assignment_id, json_extract(body, '$.work_order_id') as work_order_id,
    json_extract(body, '$.about_id') as about_id, json_extract(body, '$.type') as type
    from revisions where record_id = ? order by rev`, cur.id);
  const links = history.filter((link, i) => i === 0 || stable([link.assignment_id, link.work_order_id, link.about_id, link.type]) !==
    stable([history[i - 1]!.assignment_id, history[i - 1]!.work_order_id, history[i - 1]!.about_id, history[i - 1]!.type]));
  for (const [i, link] of links.entries()) {
    const direct = directAssignment(co, link);
    if (direct) ids.push(direct.id);
    if (link.type !== "outcome" || typeof link.about_id !== "string") continue;
    const about = get(co, link.about_id);
    if (about?.kind === "assignment") ids.push(about.id);
    else if (about) {
      const refs = co.all<Body>(`select distinct json_extract(body, '$.assignment_id') as assignment_id,
        json_extract(body, '$.work_order_id') as work_order_id from revisions where record_id = ? and (? is null or seq < ?)
        and (seq >= ? or rev = (select max(rev) from revisions where record_id = ? and seq <= ?))`,
        about.id, links[i + 1]?.seq ?? null, links[i + 1]?.seq ?? null, link.seq, about.id, link.seq);
      for (const ref of refs) { const target = directAssignment(co, ref); if (target) ids.push(target.id); }
    }
  }
  return [...new Set(ids)];
}

function rememberEntryAuthority(co: Company, id: string, ids: string[]): void {
  co.run("insert into evidence_authority (record_id, assignment_ids) values (?, ?) on conflict (record_id) do update set assignment_ids = excluded.assignment_ids",
    id, JSON.stringify([...new Set(ids)].sort()));
}

function evidenceWriter(co: Company, who: Who, kind: string, body: Body, cur?: Rec, previous?: string[]): string[] {
  if (kind !== "entry" && kind !== "task") return [];
  const ids = kind === "entry"
    ? [...(previous ?? (cur ? entryAuthority(co, cur) : [])), ...evidenceAssignments(co, body)]
    : [directAssignment(co, body)?.id].filter((id): id is string => !!id);
  for (const id of new Set(ids)) assignmentWriter(who, need(co, id));
  return ids;
}

function preserveTaskOutcomes(co: Company, cur: Rec, next: Body): void {
  if (cur.kind !== "task" || directAssignment(co, cur.body)?.id === directAssignment(co, next)?.id) return;
  // links_by_target selects only entries about this task, including archived entries. Capturing
  // authority changes no evidence body or revision and never restricts writes to a shared task.
  const entries = co.all<{ id: string }>(`select r.id from links l join records r on r.id = l.from_id
    where l.to_id = ? and l.label = 'about' and r.kind = 'entry' and json_extract(r.body, '$.type') = 'outcome'`, cur.id);
  for (const { id } of entries) {
    const entry = need(co, id);
    rememberEntryAuthority(co, id, [...entryAuthority(co, entry), ...evidenceAssignments(co, entry.body)]);
  }
}

function assignmentMetadata(fields: string[]): void {
  if (fields.some((f) => !ASSIGNMENT_METADATA.has(f))) throw forbidden("use assignment operations to change assignment lifecycle fields");
}

function nextKey(co: Company, prefix: string): string {
  const n = co.one<{ next_n: number }>("select next_n from key_counters where prefix = ?", prefix)?.next_n ?? 1;
  co.run("insert into key_counters (prefix, next_n) values (?, ?) on conflict (prefix) do update set next_n = excluded.next_n", prefix, n + 1);
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
  if (touched("status") && kind.statuses && status !== undefined && status !== null && (typeof status !== "string" || !kind.statuses.includes(status)))
    throw invalid(`status must be one of ${kind.statuses.join(", ")}`);
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
      if (target.archived) throw invalid(`${field}: ${target.key} is archived`);
    }
    return target.id;
  };
  for (const [field, value] of Object.entries(body)) {
    if (prev && stable(prev[field]) === stable(value)) continue;
    if (field.endsWith("_id")) out[field] = resolve(field, value);
    else if (field.endsWith("_ids") && Array.isArray(value)) out[field] = value.map((v) => resolve(field, v));
  }
  return out;
}

/** The words of a body, for search and for finding cited keys. Bookkeeping (`_source`...) and bare ids are left out. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") { if (!UUID.test(v)) out.push(v); }
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) strings(x, out);
  return out;
}

/** Rebuild the record's search entry and its outgoing links from its body. */
export function index(co: Company, r: Rec, kind: KindDef): void {
  const text = strings(r.body);
  co.run("delete from records_fts where id = ?", r.id);
  co.run("insert into records_fts (id, key, title, body) values (?, ?, ?, ?)", r.id, r.key, String(r.body[kind.title_field] ?? r.key), text.join("\n"));
  co.run("delete from links where from_id = ?", r.id);
  const add = (to: string | undefined, label: string) => {
    if (to && to !== r.id) co.run("insert or ignore into links (from_id, to_id, label) values (?, ?, ?)", r.id, to, label);
  };
  const idOf = (v: unknown) => (typeof v === "string" && UUID.test(v) ? co.one<{ id: string }>("select id from records where id = ?", v)?.id : undefined);
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
    co.run("insert into records (id, key, kind, rev, body, archived, created_at, updated_at, updated_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.id, r.key, r.kind, r.rev, body, r.archived ? 1 : 0, r.created_at, r.updated_at, r.updated_by);
  else
    co.run("update records set rev = ?, body = ?, archived = ?, updated_at = ?, updated_by = ? where id = ?",
      r.rev, body, r.archived ? 1 : 0, r.updated_at, r.updated_by, r.id);
  co.run("insert into revisions (record_id, rev, body, archived, changed, op, op_id, actor, actor_kind, at, why) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    r.id, r.rev, body, r.archived ? 1 : 0, JSON.stringify(changed), op, m.opId ?? null, who.name, who.kind, r.updated_at, m.why ?? null);
  index(co, r, kind);
  return r;
}

export function create(co: Company, who: Who, kindName: string, body: Body, m: WriteMeta = {}): Rec {
  return co.tx(() => {
    const kind = getKind(co, kindName);
    if (!kind) throw invalid(`unknown kind: ${kindName}`);
    let normalized = modernFields(body);
    if (kind.kind === "assignment") {
      if (who.kind !== "person" && who.kind !== "curator" && who.role !== "admin")
        throw forbidden("only a person, admin or Curator creates assignments");
      if (who.role === "viewer") throw forbidden("creating assignments needs the member role");
      assignmentMetadata(Object.keys(normalized).filter((f) => f !== "status"));
      if ("status" in normalized && normalized.status !== "queued") throw forbidden("new assignments must be queued");
      assignmentOwner(co, normalized);
      normalized = { ...normalized, status: "queued" };
    }
    const clean = checked(co, kind, normalized, null);
    const authority = evidenceWriter(co, who, kind.kind, clean);
    const at = new Date().toISOString();
    const r: Rec = { id: uuidv7(), key: nextKey(co, kind.prefix), kind: kind.kind, rev: 1, body: clean, archived: false, created_at: at, updated_at: at, updated_by: who.name };
    store(co, r, kind, "create", changedFields({}, clean), who, m, true);
    if (kind.kind === "entry") rememberEntryAuthority(co, r.id, authority);
    return r;
  });
}

/**
 * Set fields on a record. A field set to null is removed. With `baseRev`, the write is refused when the
 * record has moved on since that revision. A patch that changes nothing writes nothing.
 */
export function patch(co: Company, who: Who, ref: string, set: Body, m: WriteMeta & { baseRev?: number | undefined } = {}): Rec {
  return patchRecord(co, who, ref, set, m, false);
}

/** Internal write path for assignment handlers, after their transition/person checks. */
export function patchAssignment(co: Company, who: Who, ref: string, set: Body, m: WriteMeta = {}): Rec {
  return patchRecord(co, who, ref, set, m, true);
}

function patchRecord(co: Company, who: Who, ref: string, set: Body, m: WriteMeta & { baseRev?: number | undefined }, lifecycle: boolean): Rec {
  return co.tx(() => {
    const cur = need(co, ref);
    const priorAuthority = evidenceWriter(co, who, cur.kind, cur.body, cur);
    const normalized = modernFields(set);
    if (lifecycle && cur.kind !== "assignment") throw invalid(`${cur.key} is not an assignment`);
    if (cur.kind === "assignment") {
      assignmentWriter(who, cur);
      if (cur.archived) throw invalid(`${cur.key} is archived: restore it first`);
      if (!lifecycle) assignmentMetadata(Object.keys(normalized));
      if ("owner" in normalized && normalized.owner !== cur.body.owner && who.role !== "admin")
        throw forbidden("only an admin reassigns an assignment");
    }
    if (m.baseRev !== undefined && m.baseRev !== cur.rev) throw conflict(`${cur.key} is at revision ${cur.rev}, not ${m.baseRev}: read it again`);
    const kind = getKind(co, cur.kind)!;
    const next: Body = { ...cur.body };
    for (const [k, v] of Object.entries(normalized)) { if (v === null) delete next[k]; else next[k] = v; }
    if (cur.kind === "assignment" && "owner" in normalized) assignmentOwner(co, next);
    const clean = checked(co, kind, next, cur.body);
    const authority = evidenceWriter(co, who, cur.kind, clean, cur, priorAuthority);
    preserveTaskOutcomes(co, cur, clean);
    if (cur.kind === "entry") rememberEntryAuthority(co, cur.id, [...priorAuthority, ...authority]);
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
    if (cur.kind === "assignment") assignmentWriter(who, cur);
    const priorAuthority = evidenceWriter(co, who, cur.kind, cur.body, cur);
    if (cur.kind === "entry") rememberEntryAuthority(co, cur.id, priorAuthority);
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
 * joins that record's project (or the record itself when it is a project) and assignment.
 */
export function logEntry(co: Company, who: Who, type: EntryType, text: string, about: Rec | null, m: WriteMeta = {}, extra: Body = {}): Rec {
  const body: Body = { type, title: text.trim().slice(0, 300), ...modernFields(extra) };
  if (about) {
    body.about_id = about.id;
    if (about.kind === "project") body.project_id ??= about.id;
    else if (typeof about.body.project_id === "string" && get(co, about.body.project_id)?.kind === "project") body.project_id ??= about.body.project_id;
    if (about.kind === "assignment") body.assignment_id ??= about.id;
  }
  for (const f of ["project_id", "assignment_id"]) if (typeof body[f] === "string" && get(co, body[f])?.archived) delete body[f];
  return create(co, who, "entry", body, m);
}
