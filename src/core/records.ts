// Records of one company: the current version, every past version, links between records, and search.
// Nothing here deletes. Every change adds one row to `revisions`, in the same transaction as the change.
import { EVENT_METADATA, REVIEW_FIELDS, legacyReviewCanBind } from "./assertions.ts";
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
  assertion?: Assertion;
  assertion_context?: AssertionContext;
};
export type Revision = {
  seq: number; record_id: string; key: string; kind: string; rev: number; body: Body; archived: boolean;
  changed: string[]; op: string; op_id: string | null; actor: string; actor_kind: string; at: string; why: string | null;
};
/** Who is writing. Stored on every revision. */
export type Who = { name: string; kind: string; role?: Role };
export type WriteMeta = { why?: string | undefined; opId?: string | undefined };

export type Assertion = {
  origin_rev: number | null; event_type: string; phase: string | null; payload: Body;
  actor: string; actor_kind: string; at: string; target_record_id: string | null; target_rev: number | null;
  correction_of: string | null; binding: "bound" | "legacy_unbound";
};
export type HistoricalReview = { evidence_rev: number; target_rev: number | null; verdict: string; actor: string; actor_kind: string; at: string; note: string | null; binding: string };
export const historicalReviews = (co: Company, id: string): HistoricalReview[] => co.all<HistoricalReview>("select evidence_rev, target_rev, verdict, actor, actor_kind, at, note, binding from historical_reviews where record_id = ? order by evidence_rev", id)
  .map((r) => r.binding === "bound" && !legacyReviewCanBind(co, id, r.evidence_rev) ? { ...r, target_rev: null, binding: "legacy_unbound" } : r);
export type AssertionSubject = { key: string; kind: string; title: string; rev: number };
export type AssertionContext = { original_target: AssertionSubject | null; original_assignment: AssertionSubject | null; original_project: AssertionSubject | null; relinked: string[] };
function assertionContext(co: Company, id: string, a: Assertion, current: Body): AssertionContext {
  const seq = a.origin_rev == null ? undefined : co.one<{ seq: number }>("select seq from revisions where record_id = ? and rev = ?", id, a.origin_rev)?.seq;
  const subject = (ref: unknown, rev?: number | null): AssertionSubject | null => {
    if (typeof ref !== "string") return null;
    const r = co.one<{ id: string; key: string; kind: string }>("select id, key, kind from records where id = ? or key = ?", ref.toLowerCase(), ref.toUpperCase());
    if (!r) return null;
    const v = rev != null ? co.one<{ rev: number; body: string }>("select rev, body from revisions where record_id = ? and rev = ?", r.id, rev)
      : seq != null ? co.one<{ rev: number; body: string }>("select rev, body from revisions where record_id = ? and seq <= ? order by seq desc limit 1", r.id, seq) : undefined;
    if (!v) return null;
    const b = JSON.parse(v.body) as Body;
    return { key: r.key, kind: r.kind, title: String(b.title ?? b.name ?? r.key), rev: v.rev };
  };
  const original_target = a.target_rev == null ? null : subject(a.target_record_id, a.target_rev);
  const original_assignment = subject(a.payload.assignment_id ?? a.payload.work_order_id) ?? (original_target?.kind === "assignment" ? original_target : null);
  const original_project = subject(a.payload.project_id);
  const refKey = (ref: unknown) => typeof ref === "string" ? co.one<{ key: string }>("select key from records where id = ? or key = ?", ref.toLowerCase(), ref.toUpperCase())?.key ?? ref : null;
  const relinked = [["about", original_target?.key ?? refKey(a.payload.about_id), refKey(current.about_id)],
    ["assignment", original_assignment?.key ?? null, refKey(current.assignment_id)], ["project", original_project?.key ?? null, refKey(current.project_id)]]
    .filter(([, original, now]) => original !== now).map(([field]) => field!);
  return { original_target, original_assignment, original_project, relinked };
}
type RecRow = Omit<Rec, "body" | "archived" | "assertion" | "assertion_context"> & { body: string; archived: number; assertion_json?: string | null };
type RevRow = Omit<Revision, "body" | "archived" | "changed"> & { body: string; archived: number; changed: string };

const RECORD_SELECT = `select r.*, case when a.record_id is not null then json_object(
  'origin_rev', a.origin_rev, 'event_type', a.event_type, 'phase', a.phase, 'payload', json(a.payload),
  'actor', a.actor, 'actor_kind', a.actor_kind, 'at', a.at, 'target_record_id', a.target_record_id,
  'target_rev', a.target_rev, 'correction_of', a.correction_of, 'binding', a.binding) end as assertion_json
  from records r left join journal_assertions a on a.record_id = r.id`;
const toRec = (co: Company, row: RecRow): Rec => {
  const { assertion_json, ...r } = row;
  let body = JSON.parse(r.body) as Body;
  const assertion = assertion_json ? JSON.parse(assertion_json) as Assertion : undefined;
  if (assertion) {
    const metadata = Object.fromEntries(Object.entries(body).filter(([field]) => EVENT_METADATA.has(field)));
    const immutable = Object.fromEntries(Object.entries(assertion.payload).filter(([field]) => !EVENT_METADATA.has(LEGACY_FIELDS[field] ?? field)));
    body = { ...immutable, ...metadata, type: assertion.event_type };
    if (assertion.phase !== null) { body.phase = assertion.phase; body.external_verified = false; }
  }
  if (r.kind === "assignment") {
    for (const f of REVIEW_FIELDS) delete body[f];
    const review = co.one<HistoricalReview>("select * from historical_reviews where record_id = ? and target_rev = ? and binding = 'bound'", r.id, r.rev);
    if (review && legacyReviewCanBind(co, r.id, review.evidence_rev)) {
      body.verification = review.verdict; body.verified_by = review.actor; body.verified_at = review.at; body.verification_note = review.note;
    }
  }
  return { ...r, body, archived: r.archived === 1, ...(assertion ? { assertion, assertion_context: assertionContext(co, r.id, assertion, body) } : {}) };
};
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
  const r = co.one<RecRow>(`${RECORD_SELECT} where r.id = ? or r.key = ?`, ref.toLowerCase(), ref.toUpperCase());
  return r ? toRec(co, r) : undefined;
}

export function need(co: Company, ref: string): Rec {
  const r = get(co, ref);
  if (!r) throw notFound(`record ${ref}`);
  return r;
}

export type ListOptions = {
  kind?: string | undefined; status?: string | undefined; statuses?: string[] | undefined; archived?: boolean | "all" | undefined; limit?: number | undefined;
  /** Top-level body fields that must equal these values. */
  where?: Record<string, string | number | boolean> | undefined;
  /** Only records changed at or after this time (ISO). */
  since?: string | undefined;
  order?: "oldest" | undefined; after?: string | undefined;
  assertionSince?: string | undefined; assertionOrder?: boolean | undefined;
  associatedAssignment?: { id: string; key: string } | undefined;
};

/** Newest first. Live records only unless `archived` says otherwise. */
export function list(co: Company, o: ListOptions = {}): Rec[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (o.kind) { where.push("r.kind = ?"); params.push(canonicalKind(o.kind)); }
  if (o.status) { where.push("coalesce(json_extract(r.body, '$.status'), 'queued') = ?"); params.push(o.status); }
  if (o.statuses) { where.push(`coalesce(json_extract(r.body, '$.status'), 'queued') in (${o.statuses.map(() => "?").join(",")})`); params.push(...o.statuses); }
  if (o.archived !== "all") { where.push("r.archived = ?"); params.push(o.archived ? 1 : 0); }
  if (o.assertionSince) { where.push("a.at >= ?"); params.push(o.assertionSince); }
  if (o.associatedAssignment) {
    where.push("(json_extract(r.body, '$.assignment_id') = ? or a.target_record_id = ? or json_extract(a.payload, '$.assignment_id') in (?, ?) or json_extract(a.payload, '$.work_order_id') in (?, ?))");
    params.push(o.associatedAssignment.id, o.associatedAssignment.id, o.associatedAssignment.id, o.associatedAssignment.key, o.associatedAssignment.id, o.associatedAssignment.key);
  }
  if (o.since) { where.push("r.updated_at >= ?"); params.push(o.since); }
  for (const [field, value] of Object.entries(modernFields(o.where ?? {}))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw invalid(`bad field name: ${field}`);
    const expression = field === "type" ? "coalesce(a.event_type, json_extract(r.body, '$.type'))" : field === "phase" ? "a.phase" : `json_extract(r.body, '$.${field}')`;
    where.push(`${expression} = ?`);
    params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (o.after) {
    let cursor: unknown;
    try { cursor = JSON.parse(Buffer.from(o.after, "base64url").toString()); } catch { throw invalid("bad record cursor"); }
    if (!Array.isArray(cursor) || cursor.length !== 2 || !cursor.every((v) => typeof v === "string")) throw invalid("bad record cursor");
    const comparison = o.order === "oldest" ? ">" : "<";
    where.push(`(r.updated_at, r.key) ${comparison} (?, ?)`); params.push(cursor[0]!, cursor[1]!);
  }
  params.push(Math.min(Math.max(o.limit ?? 100, 1), 1000));
  return co.all<RecRow>(`${RECORD_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by ${o.assertionOrder ? "a.at" : "r.updated_at"} ${o.order === "oldest" ? "asc" : "desc"}, r.key ${o.order === "oldest" ? "asc" : "desc"} limit ?`, ...params).map((r) => toRec(co, r));
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
     from records_fts f join records r on r.id = f.id left join journal_assertions a on a.record_id = r.id
     where records_fts match ? and r.archived = 0
       and (case when ? is null then r.kind <> 'job' and not (r.kind = 'entry' and coalesce(a.event_type, json_extract(r.body, '$.type'), '') = 'session') else r.kind = ? end)
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

// Application roles still apply at the core boundary. Assignment owner and links are metadata.
function memberWriter(who: Who): void {
  if (who.role === "viewer") throw forbidden("record writes need the member role");
}

export const ASSIGNMENT_PROVENANCE = new Set(["reported_by", "reported_at", "answered_by", "verification", "verified_by", "verified_at", "verification_note", "_source", "provenance"]);
function assignmentFields(fields: string[]): void {
  if (fields.some((f) => ASSIGNMENT_PROVENANCE.has(f))) throw forbidden("assignment provenance and historical verification are server-controlled");
}
function assignmentOwner(co: Company, body: Body): void {
  const owner = body.owner;
  if (typeof owner !== "string" || !owner) throw invalid("an assignment needs an owner (an agent's name)");
  if (owner !== "curator" && !listAgents(co).some((a) => a.name === owner && a.active)) throw invalid(`no active agent ${owner} in this company`);
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
    const declared = field in kind.refs || field.replace(/_ids$/, "_id") in kind.refs;
    if (declared && value !== null && (typeof value !== "string" || !value)) throw invalid(`${field}: expected a record reference`);
    if (typeof value !== "string" || !value) return value;
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
  const storedBody = { ...r.body };
  if (r.kind === "assignment") for (const field of REVIEW_FIELDS) delete storedBody[field];
  if (!fresh && r.kind === "assignment") changed = [...new Set([...changed, ...REVIEW_FIELDS.filter((f) => f in r.body)])].sort();
  const body = JSON.stringify(storedBody);
  if (fresh)
    co.run("insert into records (id, key, kind, rev, body, archived, created_at, updated_at, updated_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.id, r.key, r.kind, r.rev, body, r.archived ? 1 : 0, r.created_at, r.updated_at, r.updated_by);
  else
    co.run("update records set rev = ?, body = ?, archived = ?, updated_at = ?, updated_by = ? where id = ?",
      r.rev, body, r.archived ? 1 : 0, r.updated_at, r.updated_by, r.id);
  co.run("insert into revisions (record_id, rev, body, archived, changed, op, op_id, actor, actor_kind, at, why) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    r.id, r.rev, body, r.archived ? 1 : 0, JSON.stringify(changed), op, m.opId ?? null, who.name, who.kind, r.updated_at, m.why ?? null);
  if (fresh && r.kind === "entry") {
    const type = String(r.body.type ?? "note");
    const phase = type === "action" ? (r.body.phase === "attempted" ? "attempted" : r.body.phase === "reported" ? "reported" : "unknown") : null;
    const target = typeof r.body.about_id === "string" ? get(co, r.body.about_id) : undefined;
    const correction = typeof r.body.correction_of === "string" ? need(co, r.body.correction_of) : undefined;
    if (correction && !correction.assertion) throw invalid("a correction must reference a Journal assertion in this company");
    co.run("insert into journal_assertions values (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bound')", r.id, type, phase, JSON.stringify(r.body), who.name, who.kind, r.created_at, target?.id ?? null, target?.rev ?? null, correction?.id ?? null);
  }
  const projected = need(co, r.id);
  index(co, projected, kind);
  return projected;
}

export function create(co: Company, who: Who, kindName: string, body: Body, m: WriteMeta = {}): Rec {
  return co.tx(() => {
    memberWriter(who);
    const kind = getKind(co, kindName);
    if (!kind) throw invalid(`unknown kind: ${kindName}`);
    let normalized = modernFields(body);
    if (kind.kind === "entry") {
      if (["reviewed_rev", "target_rev", "origin_rev", "original_actor", "original_at", "binding", "actor", "actor_kind", "at", "target_record_id", "assertion", "payload"].some((f) => f in normalized)) throw invalid("assertion provenance is server-controlled");
      normalized = { type: "note", ...normalized };
      if (normalized.type === "action") normalized = { ...normalized, phase: normalized.phase === "attempted" || normalized.phase === "reported" ? normalized.phase : "unknown", external_verified: false };
    }
    if (kind.kind === "assignment") {
      assignmentFields(Object.keys(normalized));
      assignmentOwner(co, normalized);
      normalized = { status: "queued", ...normalized };
      if (normalized.result !== undefined && normalized.result !== null) normalized = { ...normalized, reported_by: who.name, reported_at: new Date().toISOString() };
    }
    const clean = checked(co, kind, normalized, null);
    const at = new Date().toISOString();
    const r: Rec = { id: uuidv7(), key: nextKey(co, kind.prefix), kind: kind.kind, rev: 1, body: clean, archived: false, created_at: at, updated_at: at, updated_by: who.name };
    return store(co, r, kind, "create", changedFields({}, clean), who, m, true);
  });
}

/**
 * Set fields on a record. A field set to null is removed. With `baseRev`, the write is refused when the
 * record has moved on since that revision. A patch that changes nothing writes nothing.
 */
export function patch(co: Company, who: Who, ref: string, set: Body, m: WriteMeta & { baseRev?: number | undefined } = {}): Rec {
  return patchRecord(co, who, ref, set, m, false);
}

/** Internal write path for assignment handlers, after their transition checks. */
export function patchAssignment(co: Company, who: Who, ref: string, set: Body, m: WriteMeta = {}): Rec {
  return patchRecord(co, who, ref, set, m, true);
}

function patchRecord(co: Company, who: Who, ref: string, set: Body, m: WriteMeta & { baseRev?: number | undefined }, lifecycle: boolean): Rec {
  return co.tx(() => {
    const cur = need(co, ref);
    memberWriter(who);
    const normalized = modernFields(set);
    if (cur.assertion && Object.keys(normalized).some((f) => !EVENT_METADATA.has(f)))
      throw invalid("Journal assertion fields are immutable; append a correction with journal.correct (metadata lives under metadata)");
    if (lifecycle && cur.kind !== "assignment") throw invalid(`${cur.key} is not an assignment`);
    if (cur.kind === "assignment") {
      if (cur.archived) throw invalid(`${cur.key} is archived: restore it first`);
      if (!lifecycle) assignmentFields(Object.keys(normalized));
    }
    if (m.baseRev !== undefined && m.baseRev !== cur.rev) throw conflict(`${cur.key} is at revision ${cur.rev}, not ${m.baseRev}: read it again`);
    const kind = getKind(co, cur.kind)!;
    const next: Body = { ...cur.body };
    for (const [k, v] of Object.entries(normalized)) { if (v === null) delete next[k]; else next[k] = v; }
    if (cur.kind === "assignment" && "owner" in normalized) assignmentOwner(co, next);
    if (cur.kind === "assignment" && stable(next.result) !== stable(cur.body.result)) {
      next.reported_by = who.name; next.reported_at = new Date().toISOString();
    }
    const clean = checked(co, kind, next, cur.body);
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
    memberWriter(who);
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
  delete body.reviewed_rev; // The immutable target snapshot is resolved by the server at creation.
  for (const f of ["project_id", "assignment_id"]) if (typeof body[f] === "string" && get(co, body[f])?.archived) delete body[f];
  return create(co, who, "entry", body, m);
}
