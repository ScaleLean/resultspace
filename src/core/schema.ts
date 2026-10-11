// The tables of one company file. Everything a company owns is in its own file and nowhere else.
import type { Db } from "./db.ts";
import { invalid } from "./errors.ts";

export const SCHEMA_VERSION = 6;

// Refuses a statement outright: used for "never delete" and "history is append-only".
const forbid = (name: string, when: string, table: string, message: string) =>
  `create trigger ${name} before ${when} on ${table} begin select raise(abort, '${message}'); end;`;

const ARCHIVE_DDL = `
create table legacy_records (record_id text primary key references records(id), original_kind text not null, reason text not null) strict;
create trigger legacy_records_no_update before update on legacy_records begin select raise(abort, 'legacy archive is read-only'); end;
create trigger legacy_records_no_delete before delete on legacy_records begin select raise(abort, 'legacy archive is read-only'); end;
create trigger legacy_record_no_update before update on records when exists (select 1 from legacy_records where record_id = old.id) begin select raise(abort, 'legacy archive is read-only'); end;
`;

export const DDL = `
create table meta (k text primary key, v text not null) strict;

create table kinds (
  kind text primary key,
  prefix text not null unique,
  title_field text not null default 'title',
  statuses text check (statuses is null or json_valid(statuses)),
  refs text not null default '{}' check (json_valid(refs))
) strict;

create table key_counters (prefix text primary key, next_n integer not null) strict;

create table records (
  id text primary key,
  key text not null unique,
  kind text not null references kinds (kind),
  rev integer not null,
  body text not null check (json_valid(body)),
  archived integer not null default 0 check (archived in (0, 1)),
  created_at text not null,
  updated_at text not null,
  updated_by text not null
) strict;
create index records_by_kind on records (kind, archived, updated_at desc);

create table revisions (
  seq integer primary key autoincrement,
  record_id text not null references records (id),
  rev integer not null,
  body text not null check (json_valid(body)),
  archived integer not null check (archived in (0, 1)),
  changed text not null check (json_valid(changed)),
  op text not null check (op in ('create', 'patch', 'archive', 'restore', 'import')),
  op_id text,
  actor text not null,
  actor_kind text not null,
  at text not null,
  why text,
  unique (record_id, rev)
) strict;

${ARCHIVE_DDL}

create table ops (
  op_id text primary key,
  actor text not null,
  request_hash text not null,
  outcome text not null check (json_valid(outcome)),
  at text not null
) strict;

create table links (
  from_id text not null references records (id),
  to_id text not null references records (id),
  label text not null,
  primary key (from_id, to_id, label)
) strict;
create index links_by_target on links (to_id);

create table blobs (sha256 text primary key, size integer not null, bytes blob not null, at text not null) strict;

create table agents (
  name text primary key,
  role text not null check (role in ('viewer', 'member', 'admin')),
  active integer not null default 1 check (active in (0, 1)),
  created_at text not null
) strict;

create table agent_keys (
  key_hash text primary key,
  agent text not null references agents (name),
  created_at text not null,
  revoked_at text
) strict;


-- One row per Curator run (a review, a briefing, upkeep), with what it cost.
create table curator_runs (
  id integer primary key autoincrement, duty text not null, started_at text not null, finished_at text,
  status text not null default 'running', detail text, cost_usd real not null default 0
) strict;

create virtual table records_fts using fts5 (id unindexed, key, title, body);

${forbid("records_no_delete", "delete", "records", "records are never deleted: archive instead")}
${forbid("revisions_no_update", "update", "revisions", "history is append-only")}
${forbid("revisions_no_delete", "delete", "revisions", "history is append-only")}
${forbid("ops_no_update", "update", "ops", "the op ledger is append-only")}
${forbid("ops_no_delete", "delete", "ops", "the op ledger is append-only")}
${forbid("blobs_no_update", "update", "blobs", "blobs never change")}
${forbid("blobs_no_delete", "delete", "blobs", "blobs are never deleted")}
${forbid("agent_keys_no_delete", "delete", "agent_keys", "keys are revoked, not deleted")}
`;

export type KindDef = {
  kind: string;
  prefix: string;
  title_field: string;
  /** Allowed values of `status`, or null when any value goes. */
  statuses: string[] | null;
  /** Reference fields: field name -> the kind it must point at (null = any kind). */
  refs: Record<string, string | null>;
};

const PLAN = ["planned", "active", "complete", "archived"];
export const BUILTIN_KINDS: KindDef[] = [
  {
    kind: "company",
    prefix: "CO",
    title_field: "name",
    statuses: null,
    refs: {},
  },
  {
    kind: "project",
    prefix: "PRJ",
    title_field: "title",
    statuses: PLAN,
    refs: {
      fact_ids: "fact",
      knowledge_ids: "knowledge",
      source_ids: "source",
    },
  },
  {
    kind: "fact",
    prefix: "FCT",
    title_field: "title",
    statuses: null,
    refs: { project_id: "project", source_ids: "source" },
  },
  {
    kind: "knowledge",
    prefix: "KNW",
    title_field: "title",
    statuses: null,
    refs: {
      project_id: "project",
      source_ids: "source",
      fact_ids: "fact",
      knowledge_ids: "knowledge",
    },
  },
  {
    kind: "entry",
    prefix: "JNL",
    title_field: "title",
    statuses: null,
    refs: {
      about_id: null,
      project_id: "project",
      source_ids: "source",
      fact_ids: "fact",
      knowledge_ids: "knowledge",
    },
  },
  {
    kind: "issue_note",
    prefix: "ISN",
    title_field: "title",
    statuses: ["open", "resolved", "dismissed"],
    refs: { project_id: "project", about_id: null, source_ids: "source" },
  },
  {
    kind: "flag",
    prefix: "FLG",
    title_field: "title",
    statuses: ["open", "fixed", "dismissed"],
    refs: { about_id: null, other_id: null, evidence_ids: null },
  },
  {
    kind: "briefing",
    prefix: "BRF",
    title_field: "title",
    statuses: null,
    refs: {},
  },
  {
    kind: "source",
    prefix: "SRC",
    title_field: "title",
    statuses: null,
    refs: {},
  },
  {
    kind: "artifact",
    prefix: "ART",
    title_field: "title",
    statuses: null,
    refs: {},
  },
  {
    kind: "decision",
    prefix: "DEC",
    title_field: "title",
    statuses: null,
    refs: { project_id: "project", source_ids: "source" },
  },
];
export const ENTRY_TYPES = ["outcome", "learning", "note"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Schemas 2, 3 and 4 upgrade directly: old bodies and kind names are preserved verbatim. */
export const UPGRADES: Record<number, string | ((db: Db) => void)> = {
  6: upgradeKnowledge,
};

/** Schema 5 was an unreleased branch format; archive its issue records rather than recasting their keys. */
function upgradeKnowledge(db: Db): void {
  if (db.one<{ v: string }>("select v from meta where k = 'schema_version'")?.v !== "5") return knowledgeUpgrade(db);
  db.run("insert or ignore into legacy_records select id, kind, 'historical issue identity retired in schema 6' from records where kind = 'issue'");
  const note = BUILTIN_KINDS.find((k) => k.kind === "issue_note")!;
  if (db.one("select 1 from kinds where kind = ? or prefix = ?", note.kind, note.prefix))
    throw invalid("cannot upgrade: issue_note/ISN already exists; review a disposable migration mapping");
  db.run("insert into kinds values (?, ?, ?, ?, ?)", note.kind, note.prefix, note.title_field, JSON.stringify(note.statuses), JSON.stringify(note.refs));
  db.run("insert into meta values ('upgrade_6', ?)", JSON.stringify({ at: new Date().toISOString(), cutoff: "0.4.0", archived: db.one<{ n: number }>("select count(*) as n from legacy_records")!.n }));
}

/** No records, revisions, links, counters, credentials, blobs or op outcomes are rewritten or removed. */
function knowledgeUpgrade(db: Db): void {
  db.exec(ARCHIVE_DDL);
  const live = new Set(BUILTIN_KINDS.map((k) => k.kind));
  for (const k of db.all<{ kind: string }>("select kind from kinds")) {
    if (!live.has(k.kind))
      db.run(
        "insert into legacy_records select id, kind, 'retired in schema 6' from records where kind = ?",
        k.kind,
      );
  }
  // Raw runtime traces are historical evidence; keep them out of the meaningful project log.
  db.run(
    "insert or ignore into legacy_records select id, kind, 'runtime trace retired in schema 6' from records where kind = 'entry' and json_extract(body, '$.type') in ('session', 'action')",
  );
  for (const k of BUILTIN_KINDS) {
    const existing = db.one<{ prefix: string }>(
      "select prefix from kinds where kind = ?",
      k.kind,
    );
    if (!existing) {
      if (db.one("select 1 from kinds where prefix = ?", k.prefix))
        throw invalid(
          `cannot upgrade: prefix ${k.prefix} is already used; review on a disposable copy`,
        );
      db.run(
        "insert into kinds values (?, ?, ?, ?, ?)",
        k.kind,
        k.prefix,
        k.title_field,
        k.statuses ? JSON.stringify(k.statuses) : null,
        JSON.stringify(k.refs),
      );
    } else {
      if (k.kind === "fact" || k.kind === "issue_note")
        throw invalid(
          `cannot upgrade: kind ${k.kind} already exists; review a migration mapping on a disposable copy`,
        );
      // Keep every old declared reference too: prior company-specific links still validate.
      const old = db.one<{ refs: string }>(
        "select refs from kinds where kind = ?",
        k.kind,
      )!;
      db.run(
        "update kinds set refs = ? where kind = ?",
        JSON.stringify({ ...JSON.parse(old.refs), ...k.refs }),
        k.kind,
      );
    }
  }
  for (const table of ["presence", "evidence_authority"]) {
    if (
      db.one(
        "select 1 from sqlite_master where type = 'table' and name = ?",
        table,
      )
    ) {
      db.exec(`alter table ${table} rename to legacy_${table};
        create trigger legacy_${table}_no_update before update on legacy_${table} begin select raise(abort, 'legacy archive is read-only'); end;
        create trigger legacy_${table}_no_delete before delete on legacy_${table} begin select raise(abort, 'legacy archive is read-only'); end;
        create trigger legacy_${table}_no_insert before insert on legacy_${table} begin select raise(abort, 'legacy archive is read-only'); end;`);
    }
  }
  db.run(
    "insert into meta values ('upgrade_6', ?)",
    JSON.stringify({
      at: new Date().toISOString(),
      cutoff: "0.4.0",
      archived: db.one<{ n: number }>(
        "select count(*) as n from legacy_records",
      )!.n,
    }),
  );
}
