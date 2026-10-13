# Read-only reconciliation handoff to Prime

Implemented on isolated T3 branch `fix/historical-read-only-mode`, based on `ed2b28478e1cf15d33f3a98bb9adc18adb46c4c8` (ResultSpace 0.4). The implementation commit hash is supplied in the delivery message; `git log -1 --format=%H` identifies it in this branch. No remote push, PR, service stop/restart, deployment, live data, profile or service configuration change was performed. All server verification used synthetic temporary databases and ephemeral loopback ports.

`RS_READ_ONLY=1`/`true` freezes server mutations while retaining authenticated historical record reads, including POST-based operation and MCP reads. Unset/`0`/`false` retains write mode; invalid values refuse startup. Startup states the mode and `/health` exposes `readOnly`. Enforcement exists at dispatch, web request/service, auth storage and company database layers. `agent.key` now correctly advertises a mutation while its secret result still bypasses the ledger. Curator scheduling, deterministic checks that persist findings, agent-file initialization and harness resume are disabled.

Review points:

- All 15 registered mutation operations are denied over HTTP and MCP; all 17 registered read operations are accepted. Web write actions and chat JSON controls are denied in both sign-in and trusted modes. The read-only model-key test form POST remains accepted, with exact action selection to prevent mixed-selector bypasses.
- Tests compare all database rows and file hashes after denied writes, including authentication audits, sessions, keys, counters, ledgers, histories, settings, model-key files and agent storage. Direct service, auth, operator CLI and database write paths are covered too.
- Existing company-scoped API identities and browser sessions remain valid; new sign-in/sign-out, reset and password/account changes are denied because they write auth storage. Expired sessions cannot be renewed. Trusted access settings remain as before.
- Read-only startup requires existing schema 6 company files and the system database. It refuses automatic migration. SQLite WAL/shared-memory sidecars can still be maintained during open; this mode does not change OS permissions or prevent other processes launched without the flag from writing.
- Curator company record/history and duty logs remain readable. Chat transcripts/spend accounting are unavailable because the existing harness would open writable agent storage and resume work. No agent database is opened in this mode.

Commands run in the worktree with Node v26.7.0:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check:web
git diff --check
```

All completed successfully. `npm test` includes TypeScript checking and reported **62 tests, 62 passes, 0 failures, 0 skips**. `check:web` reported **0 errors and 0 warnings**. The production build completed with the Node adapter; its only warnings concern the environment setting both `NO_COLOR` and `FORCE_COLOR`. Full captured outputs: [tests](validation/read-only/test.txt), [build](validation/read-only/build.txt), [web check](validation/read-only/check-web.txt).

For activation, Prime must review and release the commit, retain the original data/launch/trust configuration, add `RS_READ_ONLY=1` to the existing server environment, restart during the approved release window, and verify startup, health, identity, record/history reads and write refusal. The implementation agent has not activated it. [Detailed activation and smoke checks](deploy/READ-ONLY.md).

For rollback to writes, remove the flag or set it to `0`/`false` and restart during an approved release window. Confirm `read-write` startup and `readOnly:false` health. No schema/content rollback is required; Curator pending work may resume. Reverting to earlier code removes this protection even if the flag is still present. [Detailed rollback](deploy/READ-ONLY.md#rollback-by-the-release-operator).
