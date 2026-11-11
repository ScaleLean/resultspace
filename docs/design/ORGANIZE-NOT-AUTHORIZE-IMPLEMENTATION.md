# Organize, do not authorize: implementation report

This report describes the earlier schema 5 stage. Current schema 6 integrity changes and
validation are documented in [INTEGRITY-IMPLEMENTATION.md](INTEGRITY-IMPLEMENTATION.md).

Implemented locally in the isolated feature worktree. No live company data was opened or
imported; no running service was restarted or deployed. No push, merge, external application
write or public security disclosure was performed. The running service's schema was not
rechecked. All database fixtures use synthetic identities and temporary directories.

## Behavior

Company members share assignment, task and Journal writes regardless of assignment owner or
historical associations. Agent keys, revocation, application roles, company scoping, local
reference checks, server revision attribution, append-only history, idempotency and conflict
checks remain. Curator tools retain their editor scope. Suggestions never execute on agreement.

New review and answer activity appends attributed Journal notes, including the reviewed record
revision and full note detail. Old verification evidence remains protected and readable.
Legacy permission operations record blockers and cannot require a person's answer. Action
logging is a receipt; Hermes pre-call observations are attempted activity. Journal and assignment
views label external execution unconfirmed. Compatibility aliases and receipt shapes remain,
with deprecated semantics described in ASSIGNMENTS.md and the plugin README.

## Validation

- `npm run build`: passed before application and plugin tests. Existing unused CSS warnings remain.
- `npm test`: typecheck and all 60 application tests passed. Covers core/API/MCP/CLI/web shared
  writes, authenticated provenance, role denials, unauthenticated requests, company isolation,
  key revocation, append-only history, idempotency, conflict checks and non-executing decisions.
- Hermes: `python3 -m unittest discover -s tests -v` in `integrations/hermes-plugin`: 39 passed.
- `git diff --check`: passed.
- `npm run check:web`: failed with 439 errors and 8 warnings in 21 files. The user supplied a main
  baseline of 440 errors; this report does not claim the web checker passed or that every remaining
  diagnostic was independently compared against main.

Ownership-enforcement tests were replaced with shared-company regression assertions rather
than retained as expectations for a removed product model. Security invariant suites remain.
Migration tests first generate realistic populated fixtures, then use disposable files only:
schema 2 WO keys and legacy links; schema 3; and schema 4 with populated/stale authority metadata.
They compare records, revisions, operation receipts and counters before/after, preserve historical
verification evidence, exercise edits by another member, reopen migrated copies and restore backups.

## Migration, rollback and remaining work

Schema 5 leaves authority rows inert and adds blocked status and local task assignment reference
validation. No activity or history is rewritten by this step. Opening a company migrates it
immediately; each step is transactional, and older successful steps can remain after a later
failure. Unchanged legacy references do not prevent ordinary edits; changed references must pass
current local validation. Historical verification provenance cannot be changed through generic
writes, including undo that would rewrite protected fields; an attributed correction or review
is available instead.

Older binaries reject schema 5. Rollback requires a consistent pre-upgrade backup and matching
binary, losing subsequent writes unless separately reconciled. Never lower the schema number
or open live data with this unreviewed branch. Old idempotency receipts may replay old responses
without executing again. Old clients may retain obsolete labels; attempted/report distinctions
require the updated server and plugin. No installed clients were upgraded.

Independent review is outstanding. No deployment or live migration has been authorized or done.
The existing web typecheck backlog remains separate work. Exact changed files follow.

## Changed files

- `README.md`
- `docs/design/ASSIGNMENTS.md`
- `docs/design/ORGANIZE-NOT-AUTHORIZE-IMPLEMENTATION.md`
- `integrations/hermes-plugin/README.md`
- `integrations/hermes-plugin/resultspace-memory/__init__.py`
- `integrations/hermes-plugin/resultspace-memory/facts.py`
- `integrations/hermes-plugin/resultspace/__init__.py`
- `integrations/hermes-plugin/resultspace/rsclient.py`
- `integrations/hermes-plugin/tests/test_rsclient.py`
- `src/cli/help.ts`
- `src/cli/rs.ts`
- `src/core/records.ts`
- `src/core/schema.ts`
- `src/curator/prompts.ts`
- `src/operations/assignments.ts`
- `src/operations/curator.ts`
- `src/operations/records.ts`
- `src/operations/views.ts`
- `test/api.test.ts`
- `test/assignments.test.ts`
- `test/cli.test.ts`
- `test/curator-rules.test.ts`
- `test/curator.test.ts`
- `test/migration.test.ts`
- `test/web.test.ts`
- `web/lib/EntryRow.svelte`
- `web/lib/NeedItem.svelte`
- `web/lib/server/inbox.ts`
- `web/routes/c/[slug]/assignments/[key]/+page.server.ts`
- `web/routes/c/[slug]/assignments/[key]/+page.svelte`
