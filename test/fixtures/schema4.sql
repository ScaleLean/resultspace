
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


create table evidence_authority (
  record_id text primary key references records (id),
  assignment_ids text not null check (json_valid(assignment_ids))
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

create trigger records_no_delete before delete on records begin select raise(abort, 'records are never deleted: archive instead'); end;
create trigger revisions_no_update before update on revisions begin select raise(abort, 'history is append-only'); end;
create trigger revisions_no_delete before delete on revisions begin select raise(abort, 'history is append-only'); end;
create trigger ops_no_update before update on ops begin select raise(abort, 'the op ledger is append-only'); end;
create trigger ops_no_delete before delete on ops begin select raise(abort, 'the op ledger is append-only'); end;
create trigger blobs_no_update before update on blobs begin select raise(abort, 'blobs never change'); end;
create trigger blobs_no_delete before delete on blobs begin select raise(abort, 'blobs are never deleted'); end;
create trigger agent_keys_no_delete before delete on agent_keys begin select raise(abort, 'keys are revoked, not deleted'); end;
