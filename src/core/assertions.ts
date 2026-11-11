// Immutable assertions are separate from editable organizational records. No permissions live here.
import type { Db } from "./db.ts";

const immutable = (table: string) => ["update", "delete"].map((op) =>
  `create trigger ${table}_no_${op} before ${op} on ${table} begin select raise(abort, 'assertions are append-only'); end;`).join("\n");
export const ASSERTIONS_DDL = `
create table journal_assertions (
  record_id text primary key references records(id),
  origin_rev integer,
  event_type text not null,
  phase text check (phase is null or phase in ('attempted', 'reported', 'unknown')),
  payload text not null check(json_valid(payload)),
  actor text not null, actor_kind text not null, at text not null,
  target_record_id text references records(id), target_rev integer,
  correction_of text references journal_assertions(record_id),
  binding text not null check(binding in ('bound', 'legacy_unbound')),
  foreign key(record_id, origin_rev) references revisions(record_id, rev),
  foreign key(target_record_id, target_rev) references revisions(record_id, rev)
) strict;
create index assertions_by_target on journal_assertions(target_record_id, target_rev);
create table historical_reviews (
  record_id text not null references records(id), evidence_rev integer not null,
  target_rev integer, verdict text not null, actor text not null, actor_kind text not null,
  at text not null, note text, binding text not null check(binding in ('bound', 'legacy_unbound')),
  primary key(record_id, evidence_rev),
  foreign key(record_id, evidence_rev) references revisions(record_id, rev),
  foreign key(record_id, target_rev) references revisions(record_id, rev)
) strict;
${immutable("journal_assertions")}
${immutable("historical_reviews")}
create index records_by_status on records(kind, archived, coalesce(json_extract(body, '$.status'), 'queued'), updated_at desc, key desc);
`;

// These are editable labels/associations, not part of the immutable assertion readback.
export const EVENT_METADATA = new Set(["title", "about_id", "project_id", "assignment_id", "metadata", "tags", "labels"]);
export const REVIEW_FIELDS = ["verification", "verified_by", "verified_at", "verification_note"];
type Body = Record<string, unknown>;
const bodyOf = (s: string): Body => JSON.parse(s) as Body;
const resolve = (db: Db, ref: unknown) => typeof ref === "string"
  ? db.one<{ id: string }>("select id from records where id = ? or key = ?", ref.toLowerCase(), ref.toUpperCase())?.id : undefined;

/** Add assertion/review tables and rebuild derived Journal search; preserve records and history. */
export function assertionUpgrade(db: Db): void {
  db.exec(ASSERTIONS_DDL);
  for (const r of db.all<{ id: string; key: string; body: string; created_at: string }>("select id, key, body, created_at from records where kind = 'entry'")) {
    const first = db.one<{ rev: number; seq: number; body: string; actor: string; actor_kind: string; at: string; op: string }>("select * from revisions where record_id = ? order by rev limit 1", r.id);
    const payload = bodyOf(first?.body ?? r.body);
    const known = !!first && first.rev === 1 && first.op === "create" && ["outcome", "action", "session", "note"].includes(String(payload.type));
    const type = known ? String(payload.type) : "unknown";
    const phase = payload.type === "action" ? (known && (payload.phase === "attempted" || payload.phase === "reported") ? payload.phase : "unknown") : null;
    const target = known ? resolve(db, payload.about_id) : undefined;
    // Use the target snapshot that existed when this assertion was written, never a client reviewed_rev.
    const snapshot = target && first ? db.one<{ rev: number }>("select rev from revisions where record_id = ? and seq <= ? order by seq desc limit 1", target, first.seq) : undefined;
    db.run("insert into journal_assertions values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)", r.id, first?.rev ?? null, type, phase, JSON.stringify(payload),
      first?.actor ?? "unknown", first?.actor_kind ?? "unknown", first?.at ?? r.created_at, snapshot ? target! : null, snapshot?.rev ?? null,
      known && (type !== "action" || phase !== "unknown") && (!payload.about_id || (target && snapshot)) ? "bound" : "legacy_unbound");
    const metadata = Object.fromEntries(Object.entries(bodyOf(r.body)).filter(([f]) => EVENT_METADATA.has(f)));
    const asserted = Object.fromEntries(Object.entries(payload).filter(([f]) => !EVENT_METADATA.has(f) && f !== "work_order_id"));
    const searchable = { ...asserted, ...metadata, type, ...(phase !== null ? { phase, external_verified: false } : {}) };
    const words = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(words) : v && typeof v === "object" ? Object.entries(v).filter(([k]) => !k.startsWith("_")).flatMap(([, value]) => words(value)) : [];
    db.run("delete from records_fts where id = ?", r.id);
    db.run("insert into records_fts (id, key, title, body) values (?, ?, ?, ?)", r.id, r.key, String(metadata.title ?? r.key), words(searchable).join("\n"));
  }
  for (const r of db.all<{ id: string }>("select id from records where kind = 'assignment'")) {
    let previous = "";
    for (const v of db.all<{ rev: number; body: string; actor: string; actor_kind: string; at: string; op: string }>("select * from revisions where record_id = ? order by rev", r.id)) {
      const b = bodyOf(v.body);
      const signature = JSON.stringify(REVIEW_FIELDS.map((f) => b[f] ?? null));
      if (signature !== previous && (b.verification === "verified" || b.verification === "disputed")) {
        const bound = legacyReviewCanBind(db, r.id, v.rev);
        db.run("insert into historical_reviews values (?, ?, ?, ?, ?, ?, ?, ?, ?)", r.id, v.rev, bound ? v.rev : null, String(b.verification), v.actor, v.actor_kind, v.at,
          typeof b.verification_note === "string" ? b.verification_note : null, bound ? "bound" : "legacy_unbound");
      }
      previous = signature;
    }
  }
}


/** Conservative legacy evidence binding. Self-review or missing/contradictory provenance is unbound. */
export function legacyReviewCanBind(db: Pick<Db, "all">, id: string, evidenceRev: number): boolean {
  let reporter: string | undefined;
  let result = "null";
  const validActor = (name: string) => !!name.trim() && !["unknown", "import"].includes(name);
  const validTime = (at: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(at) && Number.isFinite(Date.parse(at));
  for (const v of db.all<{ rev: number; body: string; actor: string; actor_kind: string; at: string; op: string }>("select * from revisions where record_id = ? and rev <= ? order by rev", id, evidenceRev)) {
    const b = bodyOf(v.body); const next = JSON.stringify(b.result ?? null);
    if (next !== result) {
      reporter = b.result != null && validActor(v.actor) && validTime(v.at) && ["agent", "person"].includes(v.actor_kind)
        && (b.reported_by == null || b.reported_by === v.actor) ? v.actor : undefined;
      result = next;
    }
    if (v.rev === evidenceRev) return !!reporter && reporter !== v.actor && (b.reported_by == null || b.reported_by === reporter)
      && v.op === "patch" && v.actor_kind === "person" && validActor(v.actor) && validTime(v.at)
      && b.verified_by === v.actor && b.verified_at === v.at && b.status === "done" && b.result != null;
  }
  return false;
}
