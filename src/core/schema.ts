// The tables of one company file. Everything a company owns is in its own file and nowhere else.
import type { Db } from "./db.ts";
import { invalid } from "./errors.ts";

export const SCHEMA_VERSION = 3;

// Refuses a statement outright: used for "never delete" and "history is append-only".
const forbid = (name: string, when: string, table: string, message: string) =>
  `create trigger ${name} before ${when} on ${table} begin select raise(abort, '${message}'); end;`;

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

-- Last time each agent's session checked in. Not a record: it is overwritten, and losing it loses nothing.
create table presence (agent text primary key, session text not null, at text not null) strict;

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

// Kinds every company starts with. A company adds its own (formulas, funnels, claims...) as rows.
// An assignment's lifecycle. `done` means the agent reported a result; it does not mean anyone verified it.
export const ASSIGNMENT_OPEN = ["queued", "picked_up", "in_progress", "needs_permission"];
export const ASSIGNMENT_FINAL = ["done", "failed", "cancelled"];

// Before schema 3 an assignment was a `work_order` (keys WO-...) and Journal entries pointed at it with
// `work_order_id`. Old keys stay on their records; the old names are accepted on the way in and mean the new ones.
// The kind name and the prefix stay reserved, so a WO- key always means an assignment.
export const LEGACY_KINDS: Record<string, string> = { work_order: "assignment" };
export const LEGACY_FIELDS: Record<string, string> = { work_order_id: "assignment_id" };
export const LEGACY_PREFIXES = ["WO"];
export const canonicalKind = (kind: string): string => LEGACY_KINDS[kind] ?? kind;

export const BUILTIN_KINDS: KindDef[] = [
  { kind: "company", prefix: "CO", title_field: "name", statuses: null, refs: {} },
  { kind: "goal", prefix: "GOAL", title_field: "title", statuses: PLAN, refs: {} },
  { kind: "project", prefix: "PRJ", title_field: "title", statuses: PLAN, refs: { goal_id: "goal" } },
  { kind: "task", prefix: "TSK", title_field: "title", statuses: ["todo", "in_progress", "blocked", "done", "cancelled"], refs: { project_id: "project", artifact_ids: "artifact" } },
  // A file: its bytes are an attachment (blob) named by `sha256`.
  { kind: "artifact", prefix: "ART", title_field: "title", statuses: null, refs: {} },
  // The Journal: what happened. One kind, four types: outcome (what changed or is now true), action (an
  // outward action an agent took: spend, ads, publish...), session (what an agent session did), note.
  // `about_id` is the record it is about, when there is one; `assignment_id` the assignment it was done under.
  { kind: "entry", prefix: "JNL", title_field: "title", statuses: null, refs: { about_id: null, project_id: "project", assignment_id: "assignment" } },
  // An outcome handed to one agent: brief, owner, optional project and due date, lifecycle status, the result the
  // agent reports, and (separately) whether a person verified it. Not a project (a body of work) and not a task (a to-do).
  { kind: "assignment", prefix: "ASG", title_field: "title", statuses: [...ASSIGNMENT_OPEN, ...ASSIGNMENT_FINAL], refs: { project_id: "project" } },
  // The Curator's work product. A flag is a finding about a record. A request is a change that waits for a
  // person. A briefing is the daily summary for a person.
  { kind: "flag", prefix: "FLG", title_field: "title", statuses: ["open", "fixed", "dismissed"], refs: { about_id: null, other_id: null } },
  { kind: "request", prefix: "REQ", title_field: "title", statuses: ["open", "approved", "declined"], refs: { about_id: null } },
  { kind: "briefing", prefix: "BRF", title_field: "title", statuses: null, refs: {} },
  { kind: "knowledge", prefix: "KNW", title_field: "title", statuses: null, refs: {} },
  { kind: "source", prefix: "SRC", title_field: "title", statuses: null, refs: {} },
  { kind: "decision", prefix: "DEC", title_field: "title", statuses: null, refs: {} },
  // How we do things. A skill cites the knowledge it depends on, so a change there reaches the skill.
  { kind: "skill", prefix: "SKL", title_field: "title", statuses: ["draft", "active", "retired"], refs: { knowledge_ids: "knowledge" } },
];

export const ENTRY_TYPES = ["outcome", "action", "session", "note"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Schema upgrades, oldest first. Each runs once, inside a transaction, when an older file is opened. */
export const UPGRADES: Record<number, string | ((db: Db) => void)> = {
  // 1 -> 2: results, actions, receipts and notes become Journal entries (keys and history unchanged); skills arrive.
  2: `
    insert or ignore into kinds (kind, prefix, title_field, statuses, refs) values
      ('entry', 'JNL', 'title', null, '{"about_id":null,"project_id":"project","work_order_id":"work_order"}'),
      ('skill', 'SKL', 'title', '["draft","active","retired"]', '{"knowledge_ids":"knowledge"}');
    update records set body = json_set(body, '$.type', case kind when 'result' then 'outcome' when 'action' then 'action' when 'receipt' then 'session' else 'note' end), kind = 'entry'
      where kind in ('result', 'action', 'receipt', 'note');
    delete from kinds where kind in ('result', 'action', 'receipt', 'note');
  `,
  // 2 -> 3: work orders become assignments (see assignmentUpgrade).
  3: assignmentUpgrade,
};

/**
 * Work orders become assignments. Ids, keys (WO-...), revisions, times, authors, owners, results and links are
 * kept; only the kind's name and the Journal field that points at it change. New assignments get ASG- keys.
 * History is append-only, so past revisions keep the body they had (with `work_order_id`). Refuses, changing
 * nothing, when the company already uses the name `assignment` or the prefix ASG for something else.
 */
function assignmentUpgrade(db: Db): void {
  const clash = db.one<{ kind: string }>("select kind from kinds where kind = 'assignment' or (prefix = 'ASG' and kind <> 'work_order')");
  if (clash) throw invalid(`cannot make work orders into assignments: kind ${clash.kind} already uses the name assignment or the prefix ASG`);
  const def = BUILTIN_KINDS.find((k) => k.kind === "assignment")!;
  const old = db.one<{ title_field: string; statuses: string | null; refs: string }>("select title_field, statuses, refs from kinds where kind = 'work_order'");
  db.run("insert into kinds (kind, prefix, title_field, statuses, refs) values ('assignment', ?, ?, ?, ?)",
    def.prefix, old?.title_field ?? def.title_field, old ? old.statuses : JSON.stringify(def.statuses), old?.refs ?? JSON.stringify(def.refs));
  const assignments = db.one<{ n: number }>("select count(*) as n from records where kind = 'work_order'")!.n;
  db.run("update records set kind = 'assignment' where kind = 'work_order'");
  db.run("delete from kinds where kind = 'work_order'");

  // Reference fields of every kind: work_order_id -> assignment_id, and "points at a work_order" -> "at an assignment".
  const kinds: string[] = [];
  for (const k of db.all<{ kind: string; refs: string }>("select kind, refs from kinds")) {
    const refs = JSON.parse(k.refs) as Record<string, string | null>;
    const next = Object.fromEntries(Object.entries(refs).map(([f, t]) => [LEGACY_FIELDS[f] ?? f, t === null ? null : canonicalKind(t)]));
    if (JSON.stringify(next) !== JSON.stringify(refs)) { db.run("update kinds set refs = ? where kind = ?", JSON.stringify(next), k.kind); kinds.push(k.kind); }
  }

  // Current bodies (Journal entries, mostly) point at their assignment with assignment_id.
  let relinked = 0;
  for (const r of db.all<{ id: string; key: string; body: string }>("select id, key, body from records where json_type(body, '$.work_order_id') is not null")) {
    const body = JSON.parse(r.body) as Record<string, unknown>;
    if (body.assignment_id !== undefined && body.assignment_id !== body.work_order_id) throw invalid(`${r.key} has both work_order_id and a different assignment_id`);
    const { work_order_id, ...rest } = body;
    db.run("update records set body = ? where id = ?", JSON.stringify({ ...rest, assignment_id: work_order_id }), r.id);
    relinked++;
  }
  // Links are named after the field they come from.
  const links = db.one<{ n: number }>("select count(*) as n from links where label = 'work_order'")!.n;
  db.run("insert or ignore into links (from_id, to_id, label) select from_id, to_id, 'assignment' from links where label = 'work_order'");
  db.run("delete from links where label = 'work_order'");
  db.run("insert into meta (k, v) values ('upgrade_3', ?)", JSON.stringify({ at: new Date().toISOString(), assignments, relinked, links, kinds }));
}
