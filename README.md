# ResultSpace

A lightweight company and project knowledge base, readable on a phone. Each company keeps its own records, sources, attachments and history in one SQLite file.

| Before | Now |
| --- | --- |
| Goals, tasks and agent assignments | Projects with a goal, objectives and current state |
| Assignment lifecycle, permissions, approval and dispatch | Unassigned issue/next-step notes; execution belongs to the agent's runtime |
| Action/session telemetry and presence | Meaningful chronological outcomes and sourced learning |
| Separate skills and SKILL.md sync | Sourced method learnings in project knowledge |
| Curator links, edits and approval proposals | Evidence findings, suggested corrections and briefings; claims stay unchanged |

Projects link to company-specific typed facts and freeform knowledge. A fact has a subject, property, typed value, optional unit and scope, observation date and source citations. Conflicting claims remain separate so their evidence can be compared. No ontology engine is required.

Hermes reads focused project context, works with its own tools, then explicitly records learning or an outcome. ResultSpace does not execute, dispatch or authorize work. [Agent instructions](docs/AGENT-INSTRUCTIONS.md) and [Hermes plugin](integrations/hermes-plugin/README.md).

## Read and record

```sh
rs new project title="Supplier research" goal="Confirm supply" objectives:='["Compare quotes"]' current_state="Researching"
rs project context PRJ-0001 --json
rs new fact --body '{"title":"Lead time","subject":"Supplier A","predicate":"lead_time","value_type":"number","value":4,"unit":"weeks","source":"Supplier quote dated Oct 11","project_id":"PRJ-0001"}'
rs new knowledge title="Compare quote scope" body="Check whether shipping is included." source="Supplier quotes" project_id=PRJ-0001
rs log "Lead time confirmed" --project PRJ-0001 --type learning --text "Four weeks including production." --source "Supplier email dated Oct 11"
rs curator scan
```

The same authenticated operations power HTTP (`POST /v1/op/project.context`), MCP (`project_context`), CLI and web. Histories attribute writes to the server-authenticated identity. Source citations are claims by their author, not automatic verification.

## Run locally

Needs Node 26 or newer; Python 3.11+ for plugin tests.

```sh
npm ci
npm run build
npm test
npm run check:web
node src/local.ts
```

Fresh installs use the local owner trust mode. Set `RS_TRUST=none` when sign-in is required. Add API identities and keys in Admin, then configure `rs init --server URL --company SLUG --key-file FILE`. [Local setup](docs/deploy/local.md).

For historical migration reconciliation, `RS_READ_ONLY=1` keeps authenticated reads available and refuses server writes, account/session changes and background Curator work. The default remains read-write; startup and `/health` report the mode. [Activation, access limits and rollback](docs/deploy/READ-ONLY.md).

## Upgrade and review gate

0.4.0 / schema 6 removes retired operations outright. Upgrade clients and plugin together. Old keys still resolve with `record.get` and `record.history`; retired records appear in a read-only legacy archive. Schemas 2/3/4 migrate directly, preserving bodies, ids, kinds, keys, links, full history, credentials, blobs, counters and operation outcomes. Unknown custom kinds are preserved in that archive. A per-company pre-upgrade SQLite snapshot is created automatically on file opening; it is not a whole-server backup.

Do not merge or deploy this redesign before independent review and a consistent backup/restore rehearsal from live data into disposable copies. [Migration and rollback](docs/deploy/MIGRATION.md), [product contract](docs/design/KNOWLEDGE-FIRST.md), and [handoff](docs/HANDOFF-KNOWLEDGE-FIRST.md).

MIT. [License](LICENSE).
