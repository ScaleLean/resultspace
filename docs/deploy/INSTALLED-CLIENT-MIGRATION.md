# Coordinated installed-client migration (plan only)

Independent review rejected release of the first knowledge-first implementation. No merge, deployment or installed-client change is authorized by this plan. Complete independent re-review and a consistent quiesced live backup/restore rehearsal into disposable copies before scheduling any cutover; see [server migration and rollback](MIGRATION.md).

## Reported installed state and target

Chris's review reports the default installed plugin at **0.14.0**, and **the default configuration plus seven named configurations** using the retired `resultspace-memory` provider. This turn has not inspected or modified installed plugins, profiles, skills or live company data. The seven configuration names were not supplied; record their exact names in the reviewed upgrade inventory rather than guessing or leaving them out.

Target is ResultSpace server **0.4.0 / schema 6** and repo plugin **0.15.0**, with `rs_context` and explicit sourced `rs_learn`. The installed `rs_recall`, `rs_remember`, `rs_act` and `rs_work` interfaces do not remain supported after this coordinated upgrade. Old operation families return errors; there are no inert success responses, task compatibility handlers or permission-authority shims.

| Retired client use | Reviewed replacement |
| --- | --- |
| `rs_recall` | Focused `rs_context` / `rs project context`; broader company discovery through `record.search` |
| `rs_remember` | Explicit `rs_learn` for sourced project learning, or `record.create` for freeform knowledge with citations |
| `rs_act` | Meaningful `journal.log` outcome/learning/note after runtime work; remove action tracing and guards |
| `rs_work` | Read project context and unassigned issue notes; execution stays in the Hermes runtime |
| `resultspace-memory` | Select a supported Hermes runtime memory provider during the reviewed upgrade, preserving existing memory content separately |

Source text is an author's citation, not independent verification. Method learnings stay in sourced project knowledge. Long-term ownership of reusable skills is open; do not install, sync or manage SKILL.md as part of this migration.

## Inventory before scheduling

Record all **eight** configurations: default and each of the seven named configurations. For each capture the installed plugin/provider version, its runtime home and configuration path, company slug, expected authenticated actor name/kind/role, key-file path and mode (never plaintext), tool allowlists/prompt references and memory provider/content location. Inspect named-profile overrides and default fallbacks explicitly; a successful connection to the wrong company or actor is a failed smoke test.

Preserve exact pre-upgrade server code/dependencies, a consistent server-data backup, external API key files, and per-configuration runtime/plugin/provider settings and memory content. Installed runtime settings are outside the server-data backup. Choose and validate the supported runtime memory provider and content-preservation procedure in disposable profile copies before applying it to any installed configuration.

## Disposable coordinated rehearsal

Use a disposable restored company directory and disposable copies of all eight configurations. Disable unrelated background writers. Rehearse the server upgrade and client/provider changes together, with the 0.4.0 server and 0.15.0 plugin; do not connect these tests to live companies.

For **each** configuration:

1. Verify config resolution and `/v1/me` returns the exact expected company and actor (including kind and role). Check missing/malformed config, missing/empty key, wrong/revoked key, and unreachable-server failures are clear and do not fall back to an unintended identity.
2. Load the plugin and verify only `rs_context` / `rs_learn` are registered, with no action guard, presence/heartbeat, assignment dispatch or memory extraction hooks. Remove retired tool names from the copied runtime config and prompt instructions.
3. Read a focused project with goal/objectives/current state, facts, knowledge, source inventory, log and contradiction evidence. Verify company isolation and old archived-key/history reads.
4. Record sourced learning through the plugin and CLI/API; read it back through project context and Log. Check server identity, source text/ids and revisions. Confirm uncited learning is rejected. Confirm editing current content credits the editor and preserves the original assertion/history.
5. Verify the replacement runtime memory provider reads the preserved memory content and supports its own normal memory behavior. No ResultSpace second memory/skills repository is recreated.
6. Verify the four retired interfaces and retired server operations fail explicitly. An installed old plugin appearing to load is insufficient.

Record release hashes, the exact eight config names, identity assertions, commands and outcomes. Automated repo tests cover transport and server invariants but do not establish installed Hermes compatibility or preservation of real memory content.

## Cutover and rollback gates

After independent review, the live backup/restore rehearsal, and all eight disposable client/provider smoke tests pass, an operator can separately authorize a coordinated maintenance window. Quiesce writers, take the reviewed consistent backup and configuration/memory snapshots, then upgrade server and all eight clients as one compatibility boundary. Keep writers quiesced until identity, context, record/readback and memory smoke tests pass. Do not leave 0.14.0 clients or `resultspace-memory` attached to the new server.

For a failed rehearsal or future cutover, restore the complete original server data under the original code/dependencies, and restore the matching original plugin/provider/profile/memory copies. Preserve any post-upgrade writes separately; old code must not open schema 6 databases. No step in this plan was executed on installed clients or live data in this turn.
