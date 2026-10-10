# ResultSpace: an agent-first operating system for the actual team

**Status:** proposal for review, 2026-10-10. **Owner:** Chris. **Execution:** T3 for application code; company agents for business outcomes; Prime for portfolio coordination and independent acceptance. This document proposes changes. It does not grant new credentials, deploy code, or authorize customer-facing actions.

## The job to be done

The current team includes company agents, a portfolio coordinator, a measurement specialist and a development specialist. ResultSpace must connect a decision to one accountable agent, deliver the assignment, collect evidence, show the reported result, and let a person verify it. A phone visit should answer: *What needs me? What changed? Which outcomes are stuck?*

The product has company-scoped agent keys and a common operation layer (`README.md:20-30`, `src/operations/index.ts`). Shared skills cross that boundary by design; signed-in people are server-wide admins today. Keep the useful isolation while making those exceptions visible. Do not replace ResultSpace with another board, chat transcript, or coding-agent dashboard. GitHub remains the code home. Company agents own business definitions and decisions. The measurement specialist supplies authorized read-only analysis. The development specialist owns toolchain tests and release mechanics, not store decisions. The coordinator verifies without adopting another company's identity.

### Observed baseline, not a claimed outcome

- The observed Work pages showed **zero open assignments** despite substantial task inventories. This is a point-in-time read, not a complete historical assignment count. A task count does not prove an agent received a handoff. See `web/routes/c/[slug]/work/+page.svelte:74-126`; the exact tenant evidence stays in the private audit.
- A new assignment has no direct Work-page or record-page creation form. The visible path goes through Curator chat (`web/routes/c/[slug]/work/+page.server.ts:44-65`; `web/routes/c/[slug]/r/[key]/+page.server.ts:58-97`).
- Reported-but-unverified assignments leave the default open list and do not enter the cross-company Needs you count (`src/operations/assignments.ts:67-68,146-150`; `src/operations/views.ts:113-115,175-184`). The person must navigate to the assignment page to verify.
- Presence can say “working now” for an idle live chat, and the displayed project focus can come from Journal volume rather than a claimed assignment (`src/operations/views.ts:116-130`; `integrations/hermes-plugin/resultspace/__init__.py:255-275`).
- Identity fallback and assignment authorization findings are tracked privately; both block automated dispatch. The release gate requires exact identity and server-side lifecycle enforcement before expansion.
- The baseline `npm test` passed 51 tests. The separately invoked `npm run check:web` failed with 440 errors and eight warnings (mostly missing generated SvelteKit page/data types). Restore that check before treating a web slice as green. This documentation PR did not change web source.
- The installed `resultspace-cli` agent skill described offline queuing and commands absent from the current CLI (`src/cli/rs.ts:1-3`; `src/cli/help.ts`). The skill has been corrected in the local Hermes profile. Keep released documentation and agent instructions under CLI contract tests.

These are point-in-time observations. Capture a measured baseline before claiming a speedup. “100x” is an ambition for less coordination and faster verified outcomes, **not** a measured performance claim.

## Product contract: one visible loop

1. **Define:** a person chooses the company, project or source record, desired outcome, acceptance evidence, owner, deadline, and authority boundary. The agent gets the exact merchant/account and data access route. A task may remain a checklist; it is not an implicit assignment.
2. **Hand:** one explicit action creates a queued assignment linked to the source and project. The UI shows the owner and delivery state. A later dispatcher uses durable at-least-once delivery and an idempotent claim. No model-generated chat message substitutes for delivery evidence.
3. **Execute:** the owner claims the assignment and records progress, linked sessions, outward-action intent, external read-back, blockers, and artifacts. Temporary workers may contribute, but one company agent remains accountable. Each action is distinct from its verified external effect.
4. **Report:** the owner reports a result with evidence or a precise failure. `done` means reported, never human-verified. A missing source, denied access, or pending approval stays visibly blocked.
5. **Verify:** a person sees every unverified reported result in **Needs you** across companies, checks evidence, then verifies or disputes. A dispute remains visible. A person either creates a linked revision assignment or reopens the original through a new audited transition; the chosen workflow must preserve both verdicts.
6. **Learn:** a confirmed result can update company knowledge with provenance and effective date. Agent-learned facts remain labelled and are never silently promoted to verified policy. Reusable methods go to skills, not company memory.

The contract applies to browser, CLI, MCP, scheduled jobs and gateway sessions through the same server authorization. It preserves existing company isolation and old record keys.

## Roadmap by acceptance gate

### Gate 0 — Restore trust before automation (security and identity)

- Enforce assignment lifecycle, ownership and human verification at the server boundary for every mutation operation and every transport, including compatibility routes and undo. Write adversarial tests for another member, the owning agent, and a human verifier. Keep active vulnerability details in the private remediation brief until the fix ships.
- Inventory profile → ResultSpace actor → company → role → plugin → memory provider → gateway route. Define the measurement specialist's authorized scope before provisioning a distinct identity. A `viewer` cannot claim or report assignments; a `member` currently has broader write rights. Build a narrow request/result capability before that specialist joins the assignment loop. An explicit profile with missing config must fail closed. Test fresh launches with `whoami`, not doctor alone.
- Review dormant retired-agent and importer identities. Trace actual consumers and preserve audit history. Revoke unused keys through the supported admin flow only after an owner-approved inventory and a rollback plan. Do not archive company data to make a roster look tidy.
- **Acceptance:** server-side adversarial mutation tests reject every alternate path; dedicated assignment transitions still work; each profile launch resolves to its intended actor or fails closed; no new scope is granted by fallback; a snapshot/restore rehearsal precedes production migration.

### Gate 1 — Make handoff and verification one-tap actions

- Add **Hand to agent** to project, task, goal and relevant record pages. Prefill source context but let the person edit expected outcome, acceptance check, owner and authority. Read back the saved assignment and show its delivery state inline.
- Put `done + not_verified` and disputed/failed results into the cross-company Needs you queue. Show the evidence, source, agent and consequence; Verify/Dispute must work from Home on a phone. Keep `reported`, `verified` and `accepted parent outcome` separate.
- The canonical assignment page owns lifecycle decisions. Keep generic record/history views for diagnostics, but remove the editable assignment lifecycle fields from that generic form. Preserve old URLs and keys.
- **Acceptance:** browser creates an assignment from a source record; a manually initiated owner-profile session claims and reports it; Home shows the unverified result. A person verifies or disputes it. A disputed result remains visible until a new linked revision assignment or an audited reopen transition is built and tested. Reload/restart preserves every actor and evidence link. Automated wakeup is not claimed in this gate.

### Gate 2 — Durable team execution, not presence theater

- Add a delivery ledger: queued, dispatched, received, claimed, running, blocked, reported, verified, with timestamps, run/session ID and retry reason. Use durable at-least-once delivery, an idempotent claim and bounded retry. Do not treat `ctx.inject_message` failure as success (`integrations/hermes-plugin/resultspace/__init__.py:224-295`).
- Link a CLI `rs assignment claim` to the same session/receipt context as plugin `rs_work`. Correlate action intent, tool outcome and exact external read-back. Redact secrets and customer fields. Display a missing read-back as **unverified external effect**, not a completed action.
- Show Online separately from Working on assignment. Show focus only from an explicit assignment/project link; never infer it from recent Journal volume. Make one truthful company card: next decision, accountable agent, last meaningful result, blockers and verified outcomes. Fold raw telemetry into diagnostics.
- **Acceptance:** kill a worker after claim and restart the gateway. Recovery must not duplicate the claim. If an external action may have succeeded before its receipt, require provider idempotency or human reconciliation before retry. A denied tool, timed-out request and unrecorded `rs act` each surface distinctly. One real company handoff passes end-to-end. Specialist handoff waits for its narrow request/result capability.

### Gate 3 — Trusted intelligence that saves human attention

- Make memory writes acknowledged and retryable. The provider currently marks facts seen before a successful remote write and can drop them on failure (`integrations/hermes-plugin/resultspace-memory/__init__.py:145-189`). Label recall snippets by source, status, tenant and verification. Show conflicts and stale facts rather than stacking prose into the agent brief.
- Build an outcome-focused morning brief from open decisions, unverified reports, stalled assignments and evidence freshness. Prioritize material exceptions; do not send a heartbeat digest for empty queues. The Curator proposes, cites and requests a person for meaning-changing actions.
- Provide a measurement request envelope: merchant/account IDs, metric definitions, timezone, window, allowed read route, cost ceiling, and return record. Enforce its company, route, field and cost limits on the server before calling it tenant-safe. Company agents retain the decision; the specialist returns aggregates with provenance. Never share another tenant's credential or run SQL from a wrong profile.
- **Acceptance:** server-down-then-retry loses no acknowledged fact; unsourced facts are visibly unverified; a company-specific read cannot access another company; the brief links to decisions that a person can act on directly.

### Gate 4 — Scale and simplify

- Replace `records.list(...limit:1000)` then filter with indexed owner/status queries and stable cursor pagination (`src/operations/assignments.ts:67-68,110-134`). Show real totals or “more,” never label a capped slice as total. Test more than 1,000 mixed-owner assignments and more than 50 linked receipts.
- Keep tasks for human checklists and imported history. Make assignments the executable agent handoff and projects the durable outcome context. Do not bulk-convert or delete existing tasks. Review stale imported BAC statuses/links per company before changing meaning.
- Keep `WO-` keys, old routes and operation aliases until the documented consumer and log gates pass; `docs/design/ASSIGNMENTS.md:75-83` bars removal before 2026-12-01. Do not confuse compatibility code with unused product scope.
- Demote empty rails, duplicate generic assignment editing, vanity progress ratios and machine-session volume from the primary UI. Preserve records and diagnostics. Remove only code with measured zero consumers and a migration/rollback path.
- **Acceptance:** indexed query tests pass at scale; existing URLs/keys still resolve; new UI shows the current goal → project → assignment → result → human verification without reconstructing it from separate pages.

## What to cut now, and what not to cut

**Cut through reversible presentation or instruction changes:** obsolete CLI instructions, unsupported offline-write claims, duplicate assignment edit affordances after the canonical form exists, empty rails, and “working” labels derived from presence alone. Keep local skill and released docs consistent. Cut duplicate notification jobs only after their delivery and event coverage are measured.

**Do not delete blindly:** company records, historical revisions, imported source links, old `WO-` identifiers, compatibility aliases before their migration gate, active credentials without consumer inventory, or running services. `rs act` is an audit receipt, not an approval; removing a permission prompt in the UI would not change the server boundary.

## Metrics and review cadence

Instrument before/after, by company and profile. Target **100% identity-correct launches**, **100% reported results discoverable for human verification**, **zero unauthorized assignment mutations**, and **zero false “working” claims**. Measure median and p95 time from human decision to acknowledged assignment, from report to human visibility, and from verified result to knowledge update. Measure handoff failure/retry rate, evidence-linked results, reversals, daily human taps, and tokens spent on no-change monitoring. Set improvement targets only after a one-week baseline; do not claim a literal 100x without one. Review weekly with Chris using real closed loops, not screen counts.

## Delivery order and ownership

1. T3 fixes the security boundary in an isolated worktree; Prime independently reviews tests and production behavior before any deploy.
2. Prime and the operator reconcile exact profile identities and dormant credentials. No key is copied from another profile or revoked from the live system by inference.
3. T3 builds one vertical handoff/verification slice and deploys to the private local service after backup and restore rehearsal. Prime tests human browser → real agent client → human verification → restart.
4. Only after that slice works, add dispatcher recovery, source-aware memory, analyst envelopes and large-scale pagination. Promote each slice after its stated acceptance gate, not after an agent's self-report.

The product remains a private, company-isolated ResultSpace. The plan does not authorize public exposure, billing, or broad production mutations. Chris decides which gates to accept; agents execute and return proof.
