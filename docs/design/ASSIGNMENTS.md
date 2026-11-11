# Assignments and activity

ResultSpace organizes facts, knowledge, plans, assignments and an honest Journal. It is not an
agent permission authority or approval gate. Assignment owner is organizational metadata.
This is the implementation's default interpretation of the product request, not a quotation
of an explicit confirmation in the earlier plan thread.

An assignment has a title, active company agent owner (or Curator), brief, optional project and
due date, status, and attributed reports. Any company member can create, reassign, edit,
archive, restore, claim, start, report, fail or cancel it. Owner filtering in `assignment.next`
organizes the queue; it is not a write restriction. Related tasks and Journal entries remain
shared regardless of current or historical assignment associations.

Application security remains: agent authentication and key revocation, viewer/member/admin
roles, company isolation, local reference validation, server-controlled revision actors,
append-only history, idempotency and revision conflict checks. Viewers cannot write records;
admin remains required for application administration. Curator tools retain their editor scope.

## Reports and reviews

`done` means a result was reported. It does not establish external success. `assignment.report`
stamps the authenticated reporter and time and writes an outcome entry. Generic result edits
also stamp the current actor and time. Clients cannot supply report attribution or overwrite
historical verification fields.

`assignment.review {ref, note}` appends an attributed Journal note. `assignment.show` includes
`notes` alongside outcomes, sessions and actions. Reviews do not execute, approve, unblock or
verify actions. Each note has a server-owned immutable assertion referencing the exact assignment
revision seen at creation. Historical verification is returned separately in `historical_reviews`;
compatibility `verification` fields describe the current state only when the historical review binds
exactly to its current revision. Any real edit, including status, title, archive/restore or undo,
creates a new revision and shows current state as `not_verified`. A no-op does not create a revision.
History keeps the original result and review intact. The UI shows snapshot revisions separately.

Open statuses are queued, picked_up, in_progress, blocked and legacy needs_permission. Any
member may resume or report from either blocked status. Dedicated transitions retain state
checks (claim requires queued; final records cannot be finished again). Generic status edits
remain available with kind validation and conflict checks. Archived assignments must be restored
before editing. These are record consistency rules, not agent permission decisions.

## Deprecated semantics

| Interface | Current behavior |
|---|---|
| `assignment.need_permission`, `work.need_permission` | Records a blocker as `blocked`; requires no person's answer to resume |
| `assignment.answer`, `work.answer` | Appends an answer note; does not authorize or change lifecycle status |
| `assignment.verify` | Appends a review opinion, including the supplied legacy verdict; never changes historical verification |
| `request.decide` | Any member may agree or decline; only records the request decision and never invokes its proposed operation |
| `action.record` response `decision: "allow"` | Compatibility field only. `recorded: true`, `authorization: false`, `external_verified: false` describe the receipt |
| Hermes `/v1/permissions/check` adapter | Logs activity only. Pre-call guard observations use `phase: "attempted"`; explicit receipts default to `reported` |

Installed clients retain operation names, WO/ASG keys, legacy reference aliases and output
shapes where feasible. A prior idempotent operation may replay its original stored response,
including old decision/result fields; replay never runs it again. Old clients may display
obsolete wording; upgrade them to see review and receipt semantics. Neither old `allow` responses
nor logged reports should be treated as permission or independent evidence of external success.
Hermes remains responsible for its own execution policy. ResultSpace does not execute external work.

## Old names kept as aliases

| Old interface | Now | Behaviour |
|---|---|---|
| `work.list`, `work.show`, `work.next`, `work.start`, `work.report`, `work.fail`, `work.need_permission`, `work.answer`, `work.cancel` | `assignment.*` | Same input, with the shared member rights described above. Same output, which only gains fields; `work.show` also returns `results` and `receipts`, and `work.next` returns `{work_order, claimed}`. Listed in `/v1/operations` with `replaced_by`; left out of MCP `tools/list` and the Curator's tools; still callable. Each first call per process logs `old operation name …` |
| `rs work …` | `rs assignment …` | Unchanged JSON (`work_orders`, `work_order`) and still calls `work.*`, so it works against an old or a new server. Never adds JSON `warnings` (the HUDs refuse output with warnings). Without `--json` it prints a one-line note on stderr |
| `rs act --wo` | `--assignment` / `--asg` | Sends the old field `work_order` |
| kind `work_order` in `record.create`, `record.list`, `record.search`, `rs ls`, `rs new`, `kind` lookups | `assignment` | Read as `assignment` |
| field `work_order_id` in a body or a `where` filter | `assignment_id` | Written as `assignment_id`; refused if both are given with different values |
| `work_order` input of `action.record` / `agent.receipt` | `assignment` | Accepted; both may be given if they name the same assignment |
| `work_order` on Journal items | `assignment` | Same value, still returned |
| `/c/{slug}/work/{key}` | `/c/{slug}/assignments/{key}` | 308 redirect |
| Plugin `work_list/next/show`, `/v1/work` routes, `RS_WORK_ORDER`, `work_order=` args | `assignment_*`, `RS_ASSIGNMENT`, `assignment=` | Unchanged |

**Removal.** Remove the aliases above (except the reserved `work_order` name and `WO` prefix, and
reading `work_order_id` in old revisions, which stay for good) in one change, **no earlier than
2026-12-01** and only when all of these hold:

1. Every consumer of `rs work --json` reads `rs assignment --json` → `assignments` instead.
2. Every installed `rs` is this version or newer.
3. Every Hermes profile runs plugin 0.14 or newer, and no dispatcher sets only `RS_WORK_ORDER`.
4. Agent skills teach `rs assignment`.
5. The server log has no `old operation name` line for 14 days.

## Migration (schema 2 → 3)

Runs once per company file, in one transaction, the first time new code opens the file:

- Adds kind `assignment` (prefix ASG) with the old kind's statuses and references, moves every
  `work_order` record to it, and removes kind `work_order`. Ids, keys, revs, times, authors and
  bodies stay as they were.
- Renames `work_order_id` to `assignment_id` in current bodies and in every kind's reference
  fields, and relabels `work_order` links as `assignment`.
- Does not touch revisions, the op ledger, key counters or the search index. History is
  append-only, so past revisions keep the bodies they had, with `work_order_id`.
  `record.undo` reads them under the new names.
- Writes `meta.upgrade_3` = `{at, assignments, relinked, links, kinds}`.
- Refuses and changes nothing when the file already has a kind named `assignment` or a kind
  using prefix ASG. The error names it; the file stays at schema 2.

Old code refuses a schema-3 file ("unknown schema version 3"). Rolling back therefore means
restoring the backup taken before the upgrade.

## Migration to schema 5 and rollback

Company open migrates automatically; never point unreviewed code at a live company directory.
Schema 2 retains the work-order rename above. Schema 3 passes through the schema 4 table creation.
Schema 5 retains `evidence_authority` rows as inert historical metadata: no write path reads,
reconstructs or updates them. It adds `blocked` to an assignment's existing status list and
validates task `assignment_id` references locally. Other custom statuses and references remain.
It rewrites no record, verification evidence, revision, key counter or operation receipt.
Each upgrade step is transactional; earlier successful steps remain if a later step fails.

Schema 4 and older binaries refuse schema 5. Do not lower the schema number to roll back: old
binaries would restore authority restrictions and old approval behavior. Use a consistent
pre-upgrade backup with its matching binary. Restoring that backup loses post-backup writes;
preserve a separate copy of the schema 5 file for reconciliation. Tests use generated, populated
schema 2/3/4 fixtures and disposable copies only, including stale authority metadata, reopen,
backup/restore and historical verification preservation. Live-file migration, deployment and
independent review remain separate work.


## Organizational state and immutable assertions (schema 6)

Members edit organizational state; an assertion records what one actor asserted at one time
about one specific snapshot. State edits never rewrite an assertion or carry its review forward.
Schema 6 stores Journal assertions separately, with database update/delete refusal triggers and
foreign keys to immutable origin/target revisions. Actor, time and target revision come from the
server, not fields supplied by a client. Assertion payload/type/phase are immutable.

Journal `record.patch` accepts title (an organizational label), local associations, tags, labels
and `metadata`. Other arbitrary editable fields belong under `metadata`. Original asserted title,
payload, actor, time and phase are read from `assertion`; Journal and assignment activity displays
use these original values. Archive, restore and undo affect organizational metadata only.
`journal.correct {ref, title, detail?, phase?}` appends an attributed assertion linked by
`correction_of`; it never changes the original and never confirms external execution. It is also
available through the ordinary operation API/MCP. Existing CLI clients can append a correction with
`rs new note title="Correction" correction_of=JNL-0001 about_id=JNL-0001` (synthetic key shown).
Legacy payload-rewriting calls now fail explicitly. WO/ASG keys and existing aliases remain.

`assignment.list` filters open statuses (unless `all`), owner and project in SQL before limiting.
Its array shape remains; each row adds `cursor`. Continue with `after` equal to the last row's cursor,
using the same filters, until an empty page. `today.get` accepts owner/project/limit and independent
`after` (open_work) and `needs_after` (needs_you) cursors. Each respective row carries its cursor.
`assignment.next` queries the caller's oldest queued record directly. Cursors order by update time
and key; concurrent edits can move rows between pages, so pagination is not a frozen snapshot.

Schema 6 adds `journal_assertions`, `historical_reviews` and a status index. It rebuilds derived
Journal search data; it does not rewrite record bodies, revisions, keys, receipts, counters or
inert authority metadata. Migration uses the earliest preserved Journal revision, not the latest
edited body. Imported/missing origins, unknown action phases or unresolved target snapshots remain
historical/unbound, with unknown phase rather than an inferred report. Legacy review evidence binds
only when its review-bearing revision has matching server actor/time, a done result and a person
actor; otherwise it is historical/unbound. Carried body fields cannot bind later revisions.
No old assertion is silently relabeled as successful external execution.

Opening a file upgrades it automatically. Upgrade 6 is transactional; prior successful upgrade
steps may remain after a later failure. Old binaries reject schema 6. Roll back by restoring a
consistent pre-upgrade backup with its matching binary, preserving the upgraded file separately
for reconciliation. Lowering the schema number or dropping tables discards integrity information
and is unsafe. A restored backup loses subsequent writes. Stored idempotency outcomes remain
historical responses and can replay old labels; current reads use the new projections.
No live migration or deployment is authorized by this implementation.
