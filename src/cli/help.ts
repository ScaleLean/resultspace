// Help text for `rs`.
export const HELP = `rs: the ResultSpace command line for people and agents.
It talks to the server directly. Every command works in one company (--company SLUG, or the profile's default).

Records
  rs ls KIND [--status S] [field=value] [--archived|--all]   list records, newest first
  rs show KEY                                                 one record
  rs new KIND title="..." field=value [--result "outcome"]    create (or --body '{"json":...}')
  rs set KEY field=value field:=json field:=null [--result]   edit fields (:=null removes a field)
  rs archive KEY | rs restore KEY                             nothing is ever deleted
  rs search "words" [--kind K]   (alias: rs ask)              full-text search with a snippet
  rs history KEY | rs context KEY                             versions; the record with its links
Assignments (an outcome handed to one agent; old name: work orders, rs work)
  rs assignment [--all] [--owner NAME] [--project PRJ] | next | claim KEY | show KEY | start KEY [--progress "..."]
  rs assignment report KEY --result "outcome" | fail KEY --result "why" | need-permission KEY --detail "what a person must decide"
  rs assignment answer KEY --answer "..." | cancel KEY [--why "..."] | verify KEY [--disputed] [--note "what you checked"]
  rs act ACTION --detail "what you did" [--amount N --unit $] [--assignment KEY]   record an outward action
Work
  rs task add "title" [--project PRJ] | rs task done KEY [--result "..."] | rs task attach KEY ./file
  rs note add "title" [--text "..."] [--result "..."]
Journal (what happened)
  rs log "Label shipped to the printer" [--about KEY] [--project PRJ] [--type note]    write an entry (an outcome by default)
  rs journal [--type outcome|action|session|note] [--since 7d] [--project PRJ]        read it (alias: rs results)
Skills (how we do things; a skill cites the knowledge it depends on)
  rs skills [--search words] | rs skills show SKL-0001 | rs skills sync [DIR]   (sync writes SKILL.md files for Hermes)
  rs new skill title="..." when="..." body="..." knowledge_ids:='["KNW-0001"]' status=active
Views
  rs brief | today | activity [--since 24h] | plans | knowledge [COLLECTION] [--search "..."]
Setup
  rs init --server URL --company SLUG --key-file FILE     point this profile at a server with one company's key
  rs whoami | companies | status | doctor | kinds | agents [add NAME | key NAME --out FILE | revoke NAME]

Flags anywhere: --json (one JSON document: {"ok","command","data"}), --company SLUG (-C), --profile NAME, --all-companies.
Exit codes: 0 ok, 2 usage, 3 key problem, 4 not found or not allowed, 5 conflict, 6 refused by a rule, 7 server unreachable.
More: rs help agents | assignments | results | json | config`;

export const TOPICS: Record<string, string> = {
  agents: `AGENTS
Start of a session: rs brief
Assignments: rs assignment next (or claim KEY)  ->  rs assignment start KEY  ->  rs assignment report KEY --result "outcome"
If you cannot finish: rs assignment fail KEY --result "why". If a person must decide: rs assignment need-permission KEY --detail "..."
Your report is your word, not a check: a person verifies it separately (rs assignment verify).
Outward actions (spend, ads, publish, email_customers, message_customers, prices, ecommerce, deploy) need no permission.
Record each one so a person sees it: rs act publish --detail "Updated the listing copy" [--assignment KEY]`,
  assignments: `ASSIGNMENTS
An assignment is an outcome handed to one agent: a brief, an owner, an optional project and due date, a status,
and the result the agent reports. It is not a project (a body of work) and not a task (a to-do).
Keys: ASG-0001 for new ones. Assignments made before the rename keep their WO-0001 keys; both work everywhere.
Lifecycle: queued -> claimed (next | claim) -> in progress (start) -> result reported (report) | not finished (fail)
  needs your permission (need-permission) waits for a person (answer); a person may cancel any open one.
Five things stay apart: the assignment; what the agent's sessions did (receipts); outward actions it recorded
(rs act); the result it reported; and whether a person verified that result (rs assignment verify [--disputed]).
Old names, still accepted: rs work (same JSON: work_orders, work_order), --wo, kind work_order, work_order_id.
See docs/design/ASSIGNMENTS.md for when they go.`,
  results: `THE JOURNAL
The Journal is what happened: outcomes, outward actions, agent sessions, notes. An outcome says what changed
or is now true. Lead with the outcome, not the effort.
  rs log "Supplier confirmed 4-week lead time" --about TSK-0007
  rs set TSK-0007 status=done --result "Supplier confirmed 4-week lead time"   (same thing, in one step)
  rs assignment report ASG-0003 --result "Label matches the formula"
An entry joins its record's project. Read it: rs journal [--type outcome] [--since 7d] [--project PRJ-0001]`,
  journal: "see: rs help results",
  json: `JSON OUTPUT
With --json every command prints exactly one JSON document on stdout:
  success: {"ok": true, "command": "ls", "data": ..., "warnings": []}
  failure: {"ok": false, "error": {"code": 4, "kind": "forbidden", "message": "..."}}
The exit code equals error.code (0 on success). Records have a stable shape:
  {"id","key","company_id","kind","title","status","rev","sync_state","pending_ops","archived","body","conflict"}
company_id is the company slug. Keys never appear in any output.`,
  config: `CONFIG
~/.config/resultspace/profiles/<profile>/cli.toml (or ~/.config/resultspace/cli.toml, or $RS_CONFIG):
  server_url = "http://127.0.0.1:4390"
  default_company = "acme"
  [companies.acme]
  key_file = "/path/to/acme.key"     # chmod 600; one key per company
The profile is --profile, else $RS_PROFILE, else the Hermes profile, else "default".`,
};
