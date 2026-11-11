# Organizational state and immutable assertions

Local implementation on the existing isolated feature branch. Independent review remains
required; this is not a merge/deployment readiness claim. No live company file was opened,
service restarted, external write performed, branch pushed or merge performed.

Members edit organizational state. An immutable assertion records what one actor asserted at
one time about one specific snapshot. Edits never rewrite assertions or carry review forward.
This adds no agent permission authority. Existing authentication, key revocation, application
roles, company files, local reference validation, provenance, revision history, conflict and
idempotency checks remain. Suggestion decisions remain non-executing.

## Implementation

- Schema 6 adds immutable `journal_assertions` and `historical_reviews`, revision foreign keys,
  append-only triggers and a status index. Existing revision snapshots provide the binding;
  no duplicated state snapshots or new policy engine are introduced.
- Creation writes an assertion atomically with the record and its first revision. Original
  payload/type/phase, actor/time and target revision come from this immutable row on readback.
  Generic Journal writes edit organizational labels, validated associations and metadata.
  Undo/restore cannot rewrite asserted content. `journal.correct` appends a linked attributed
  assertion; a later reported correction leaves the original attempt intact. No receipt
  confirms external execution.
- Assignment compatibility verification is derived from historical review binding to the
  current revision. Every changed state, including status, metadata, archive/restore and undo,
  has a new revision and no inherited verification. No-op writes retain their revision.
  Historical reviews and revision bodies remain readable; new review notes bind server-side
  to their subject snapshot and confer no authorization or verification.
- Work queries apply status/owner/project filters before limits. List/today array shapes stay;
  rows add stable time/key cursors, with `after` and separate `needs_after` for today's lists.
  Next claims the oldest eligible queued row directly. Pagination is not a frozen snapshot
  under concurrent edits. Generic records, linked assignment activity, Journal, Today, pulse,
  search and web forms/readbacks were examined; the core assertion projection is shared.
- WO/ASG keys, aliases and installed-client response shapes remain where feasible. Journal
  payload-rewriting calls are intentionally incompatible: use metadata or append a correction.
  Older cached idempotency responses retain historical labels; replay never executes again.
  CLI generic record JSON retains its existing shape; immutable phase is projected in its body.
  The server/API returns the full assertion for original provenance. No client was installed
  or upgraded. Hermes missing status still reads unknown, with explicit success/failure intact.

## Migration and rollback

Opening a company automatically migrates it; never open live data with this branch. Upgrade 6
is one transaction. Earlier successful upgrade steps can remain after a later step fails.
It does not rewrite record bodies, revision history, keys, counters, stored operation receipts
or inert authority metadata. It rebuilds derived Journal search text from the immutable
assertion plus editable metadata so later body claims are not reused as original evidence.

Journal migration uses the earliest preserved revision. Missing/imported origins, unknown
phases or unresolved target snapshots are historical/unbound. Missing phase is unknown, never
inferred reported. Review-bearing legacy revisions bind only when matching server actor/time,
person attribution and a done result establish the reviewed snapshot; ambiguous evidence
remains historical/unbound. Carried verification fields never bind a later revision.

Disposable synthetic schema 2, 3, populated 4 and 5 fixtures cover retained history/keys/receipts,
shared edits despite stale authority, original assertions after legacy edits, ambiguous origins
and reviews, status-only changes, undo/restore, reopen, backup/restore and upgrade-6 failure
rollback. There was no live import or migration.

Older binaries refuse schema 6. Rollback requires a consistent pre-upgrade backup and its
matching binary, preserving the upgraded file separately for reconciliation. Restoring a
backup loses subsequent writes. Lowering the schema version or dropping integrity tables is
unsafe. Migration duration and real legacy-data distributions have not been measured; review
of the conservative legacy binding criteria is outstanding.

## Validation

- `npm run build`: passed before app/plugin tests; existing CSS warnings remain.
- `npm test`: typecheck and 72 tests passed, including new adversarial assertion/correction,
  exact review binding, pagination beyond 1,000 newer closed assignments and migration tests.
  Existing API/MCP/CLI/web security and shared-company suites remain passing.
- Plugin: `python3 -m unittest discover -s tests -v` in `integrations/hermes-plugin`: 42 passed.
- `git diff --check`: passed.
- `npm run check:web`: remains red: 441 errors, 8 warnings in 21 files in this worktree.
  User-supplied main baseline is 440 errors; the preceding local stage recorded 439 errors.
  New markup adds two occurrences of the existing missing page-data typing diagnostic.
  This is reported separately, not claimed passed or resolved by the production build.

## Exact files changed in this integrity stage

- `src/core/assertions.ts` (new)
- `src/core/records.ts`
- `src/core/schema.ts`
- `src/operations/assignments.ts`
- `src/operations/curator.ts`
- `src/operations/views.ts`
- `test/api.test.ts`
- `test/assignments.test.ts`
- `test/cli.test.ts`
- `test/integrity.test.ts` (new)
- `test/migration.test.ts`
- `web/lib/EntryRow.svelte`
- `web/routes/c/[slug]/assignments/[key]/+page.server.ts`
- `web/routes/c/[slug]/assignments/[key]/+page.svelte`
- `web/routes/c/[slug]/r/[key]/+page.server.ts`
- `web/routes/c/[slug]/r/[key]/+page.svelte`
- `docs/design/ASSIGNMENTS.md`
- `docs/design/ORGANIZE-NOT-AUTHORIZE-IMPLEMENTATION.md`
- `docs/design/INTEGRITY-IMPLEMENTATION.md` (new)
