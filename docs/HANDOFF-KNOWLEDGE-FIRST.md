# Knowledge-first ResultSpace handoff

Implemented in `feat/knowledge-first-resultspace`, isolated from clean main `9ca71202a4f606a16fcc197efd7962b1618992e3`.
Implementation commit: `eb7fa30360e4740d141b27828b59cf8d7758dc58` — Redesign ResultSpace around sourced project and company knowledge.
This handoff and its file manifest are the immediately following documentation commit; use `git log -2 --format='%H %s'` for both exact hashes.

No live company files, interrupted worktree, installed Hermes skills/profiles or live processes were modified. No push, deployment, merge or PR. Temporary verification servers and their disposable company data were stopped and removed.

## Product map

| Before | After |
| --- | --- |
| Task/work assignment lifecycle and approval gates | Projects: goal, objectives, current state; unassigned issue notes |
| Permission checks, action guards and dispatch | Authenticated read/record operations; runtime execution stays with Hermes |
| Presence, heartbeat and raw runtime traces | Meaningful chronological learning/outcome/note log |
| Second skills repository and sync | Sourced methods in freeform project/company knowledge |
| Curator edits/proposals/links | Regular evidence checks, flags, suggestions and briefings; claims unchanged |
| Task-only browser views | Phone-readable projects, facts, knowledge, sources, log, issues, Curator and archive |

HTTP, CLI and MCP share the operation registry. `project.context` returns focused records, source snapshots, authenticated revision provenance, chronological log, open findings and a truncation indicator. Typed facts are small subject/property/value records; freeform knowledge covers organic learning. Repo-owned plugin 0.15.0 has explicit `rs_context` / `rs_learn` tools and no interception or extraction hooks.

## Verification

Final verification on disposable fixtures/copies, Node 26:

| Command/check | Result |
| --- | --- |
| `npm run build` | Passed, SvelteKit adapter-node production build |
| `npm test` | TypeScript check and 42 tests passed; 0 failures/skips |
| `npm run check:web` | Passed: 0 errors, 0 warnings |
| `python3 -m unittest discover -s integrations/hermes-plugin/tests -v` | 3 passed |
| `git diff --check` / staged diff check | Passed |
| T3 native browser, 390×844 | Sign-in, project author/read, linked facts/knowledge, source provenance and contradiction finding; document width 390, no horizontal overflow |

Retained tests cover authenticated company isolation (HTTP/CLI/MCP), role/key/session/trust rules, cross-site web writes, optimistic revisions/idempotency/undo, immutable attachments/history/provenance, typed references, exact factual contradiction snapshots, Curator deduplication and read-only authority, and periodic no-model evidence scans. Real API + CLI retrieves project context and records sourced learning. Web tests author and read projects/facts/knowledge/issues/log, then inspect context/evidence/history and key revocation.

Migration tests materialize prior schema 2/3/4 layouts with old work/assignment kinds, linked historical traces, custom records, revisions, credentials, operations and attachment data. They compare original rows verbatim after upgrade, authenticate copied credentials, exercise read-only old keys and direct SQL guards, and rehearse original-schema rollback. Prefix and new-kind collisions abort atomically. Directory rehearsal covers committed WAL, accounts/sessions, Curator SQLite files, hashes, integrity checks, tamper rejection and refusal to overwrite existing destinations. Fixtures are synthetic prior-schema data, not a sample of live company files.

Paid/live model evals were updated but not run. Curator model tests use controlled responses. Plugin transport/tool tests ran against a real disposable ResultSpace API; the installed Hermes runtime was not exercised or modified.

## Removal measurements and exact files

[Exact changed-file manifest](CHANGED-FILES-KNOWLEDGE-FIRST.txt) lists all 122 implementation paths plus the two handoff files. Counts compare the implementation commit to clean base, using `git diff --numstat`; formatting contributes to gross line counts.

| Scope | Lines added | Lines deleted | Net lines removed |
| --- | ---: | ---: | ---: |
| Runtime (`src`, `web`, `scripts`, plugin runtime/provider paths) | 3,478 | 4,923 | 1,445 |
| Tests and migration fixtures | 1,580 | 2,096 | 516 |
| Entire implementation including docs/lockfile/evals | 5,281 | 7,862 | 2,581 |

33 complete files were deleted. Four former test files (assignment, plugin facts/guard/client) were retired/replaced: 17 TypeScript declarations and 39 Python methods. Retained transport/authentication invariants moved to the focused suites; mixed application suites retain company isolation, provenance and safety checks. This is not a claim that every gross deletion is dead logic or that tests alone establish release readiness.

## Data, cutoff and rollback

Schema 5 migrates directly from 2/3/4 in a transaction, retaining exact record bodies/kinds/ids/keys/revisions/authors/times/archive states, links/search rows, revision history, operation outcomes, counters, blobs and hashed API keys. Retired/custom records and raw session/action entries are mapped to a read-only archive, readable through original keys/history. Presence and evidence-authority rows remain in write-disabled legacy tables. No user rows are deleted. Each company gets a consistent pre-upgrade SQLite snapshot before migration; this is only a company backup.

Server 0.4.0 removes old assignment/work/permission/action/presence/approval/skill operations. There are no compatibility success handlers or shadow task manager. Old operation families receive not-found with an upgrade explanation; old views return 404. Upgrade client configuration and plugin together through a reviewed release. Installed memory-provider/profile changes and long-term skill ownership remain external decisions.

[Migration procedure](deploy/MIGRATION.md) describes quiesced whole-directory backup, restore into a new disposable directory, integrity/hash checks and original-release rollback. External CLI key files and Hermes/runtime profiles must be preserved separately. Nested data directories require explicit scope review. Later schema 5 writes must be preserved separately when restoring a pre-upgrade backup.

## Remaining gaps and next gate

1. Independent review of this exact implementation, especially migration archive mappings, authentication boundaries, Curator write limits and client cutoff. No independent review has happened in this worktree.
2. Consistent backup/restore rehearsal from quiesced **live** data into disposable copies, including copied-credential authentication, attachment/history comparisons, upgrade smoke paths and rollback under the original release. The automated fixture rehearsal does not satisfy this gate. No live data was accessed.
3. Reviewed installed-client/Hermes upgrade testing before release. No installed SKILL.md/profile/provider changes here; no skill installation or sync.

Functional limits: deterministic contradictions require matching subject/property/scope/unit and compare typed values; there is no unit conversion or prose ontology. Source citations remain author claims rather than automatic external verification. Optional model accuracy/prose review requires configured provider access. Context uses explicit project links/citations; search provides broader discovery. Custom legacy kinds require a human mapping decision before any future editable conversion. Signed-in people retain existing server-owner access across companies, while API keys remain company-scoped; per-person memberships are outside this redesign. Attachment bytes remain accessible through the API; this change does not add a dedicated web attachment-upload flow.

Do not merge or deploy until gates 1 and 2 pass and the installed-client upgrade is consistent with the cutoff. The implementation is complete and reviewable; these are release gates, not hidden stubs.
