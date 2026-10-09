# Assignments

An **assignment** is an outcome handed to one agent: a brief, an owner, an optional project and due
date, a lifecycle status, the result the agent reports, and the actions and session receipts recorded
under it. It is not a **project** (a body of work with many parts) and not a **task** (a to-do on a
list). Until schema 3 it was called a work order (`work_order`, keys `WO-…`).

Five things stay apart, in the data and in every view:

| | What | Where it lives |
|---|---|---|
| Assigned | the outcome wanted, who owns it, its status | the assignment record |
| Executed | what the agent's sessions did | Journal `session` entries (`agent.receipt`) with `assignment_id` |
| Acted | outward actions the agent took (spend, ads, publish…) | Journal `action` entries (`action.record`) with `assignment_id` |
| Reported | the result the agent says it got | `result`, `reported_by`, `reported_at`, and an `outcome` entry |
| Verified | a person, not the reporter, checked that result | `verification` (`verified` or `disputed`), `verified_by`, `verified_at`, `verification_note` |

A reported result is the agent's word. Status `done` means "result reported", never "verified".

## Record

Kind `assignment`, key prefix **`ASG`** (`ASG-0001`). Assignments made before schema 3 keep their
`WO-0001` (and imported `WO-001`) keys; both resolve everywhere a key is accepted. The kind name
`work_order` and the prefix `WO` are reserved: `kind.define` refuses them, so a `WO-` key always
means an assignment.

Body fields: `title`, `owner` (an active agent, or `curator`), `brief`, `project_id`, `due_on`,
`status`, `progress`, `answer`, `answered_by`, `result`, `reported_by`, `reported_at`,
`verification`, `verified_by`, `verified_at`, `verification_note`. Journal entries point at their
assignment with `assignment_id`.

## Lifecycle

| Status (stored) | Words | Moved by |
|---|---|---|
| `queued` | Waiting for the agent | created (`record.create`, kind `assignment`) |
| `picked_up` | Claimed | owner: `assignment.next` (oldest) or `assignment.claim` (by key), from `queued` only |
| `in_progress` | In progress | owner: `assignment.start`, from queued/claimed/in progress; admin: `assignment.answer` |
| `needs_permission` | Needs your permission | owner: `assignment.need_permission`. Only a person's `assignment.answer` moves it on |
| `done` | Result reported | owner: `assignment.report`, from queued/claimed/in progress |
| `failed` | Reported not finished | owner: `assignment.fail`, from any open status |
| `cancelled` | Cancelled | admin: `assignment.cancel`, from any open status |

The owner or an admin moves an assignment; others get `forbidden`. `assignment.verify` (verdict
`verified` or `disputed`) needs an admin who is a **person** and is not the one who reported the
result, and only applies to `done`. Everything stays inside one company file: another company
cannot see, list, claim or link to it.

## Contract

| Surface | New |
|---|---|
| Operations | `assignment.list` (`all`, `owner`, `project`, `limit`), `assignment.show` (adds `outcomes`, `sessions`, `actions`), `assignment.next` → `{assignment, claimed}`, `assignment.claim`, `assignment.start`, `assignment.report`, `assignment.fail`, `assignment.need_permission`, `assignment.answer`, `assignment.cancel`, `assignment.verify`; `action.record` and `agent.receipt` take `assignment` |
| Assignment JSON | the old work-order fields (`id key rev title owner status status_words brief result progress answer due_on project updated_at`) plus `kind: "assignment"`, `reported_by`, `reported_at`, `verification: {state, by, at, note}` |
| Journal items | `assignment` (the assignment's key) |
| CLI | `rs assignment` (aliases `rs assignments`, `rs asg`): `ls [--all --owner --project] \| next \| claim \| show \| start [--progress] \| report --result \| fail --result \| need-permission --detail \| answer --answer \| cancel [--why] \| verify [--disputed] [--note]`; JSON `{assignments}` / `{assignment}`; `rs act --assignment KEY`; `rs help assignments` |
| Web | `/c/{slug}/assignments/{key}` (with a Verified / Disputed form for a reported result); Work page and project pages list "Assignments" |
| MCP / Curator | tools `assignment_*`; the Curator hands out work with `record_create` kind `assignment` |
| Hermes plugin 0.14 | `Client.assignment_list/next/claim/show`; `RS_ASSIGNMENT`; tool `rs_work` lists, claims and shows assignments |

## Old names kept as aliases

| Old interface | Now | Behaviour |
|---|---|---|
| `work.list`, `work.show`, `work.next`, `work.start`, `work.report`, `work.fail`, `work.need_permission`, `work.answer`, `work.cancel` | `assignment.*` | Same rights and input. Same output, which only gains fields; `work.show` also returns `results` and `receipts`, and `work.next` returns `{work_order, claimed}`. Listed in `/v1/operations` with `replaced_by`; left out of MCP `tools/list` and the Curator's tools; still callable. Each first call per process logs `old operation name …` |
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

## Changes that are not pure renames

- Record outputs (`record.get`, `record.list`, `rs show`, `rs ls`) say `kind: "assignment"` for old WO- records too.
- Current Journal entry bodies hold `assignment_id`, not `work_order_id`. A reader of a raw body's
  `work_order_id` must switch. Journal items still carry `work_order`.
- `status_words`: "Picked up" is now "Claimed", "Done" is "Result reported", "Failed" is "Reported not finished".
- An agent cannot move its own assignment out of `needs_permission` with `start` or `report`
  (`work.start` did allow it). Only a person's answer moves it on. `claim` only takes a `queued` one.
- The Curator's upkeep findings are named "assignment not claimed" and "assignment stalled".
- The live-session hand-off in the plugin offers only the agent's own queued assignments, and says
  `rs assignment claim KEY`.

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
