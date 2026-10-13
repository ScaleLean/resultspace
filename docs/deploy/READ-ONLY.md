# Historical reconciliation read-only mode (0.4)

Keep the existing ResultSpace server available while comparing its records with the Notion migration. Enable `RS_READ_ONLY=1` (or `true`) in the server process environment. Unset, `0`, or `false` preserves read-write behavior. Any other value refuses startup. The mode is fixed at startup; changing an environment variable requires an operator-controlled restart.

Prime must independently review and release this change. The implementation worktree does not change the running service, its data, profiles, service configuration, or deployment.

## Activation by the release operator

1. Review the commit and run the checks below in an isolated worktree. Confirm the existing company databases are already schema 6 and `_system.sqlite` exists. Read-only startup refuses older company schemas instead of migrating them or making upgrade backups. Do not enable a write-mode startup just to bypass this refusal on historical data.
2. Preserve the current launch command, data directory, host, port, trust setting and credentials. At the approved release window, add **only** `RS_READ_ONLY=1` to that server's environment and restart it with the reviewed code. For direct launch, the equivalent is `RS_READ_ONLY=1 DATA_DIR=/path/to/existing/data node src/server.ts`; for the local launcher, `RS_READ_ONLY=1 node src/local.ts --no-open` (retain its existing `--data`, `--host`, `--port`, and trust flags). These are operator instructions, not actions performed by the implementation agent.
3. Confirm startup prints `ResultSpace mode: read-only (historical reconciliation; writes and Curator disabled)` and `GET /health` reports `"readOnly":true`.
4. With an existing company API key, confirm `GET /v1/me` identifies its original company and actor, `POST /v1/op/record.get` and `record.history` accept an existing key, and a write returns HTTP 403 with `error.code = "read_only"`. MCP read tools still accept POST; mutation tool calls return `isError:true` with `read_only:`. Compare migration data through these existing read operations.

## Enforcement and retained access

- Every mutation in the shared operation registry is refused before execution, transaction entry or idempotency-ledger replay. This includes record create/patch/archive/restore/undo, journal logging, company updates, agent add/key/revoke/activation, blob uploads and Curator findings/briefings. `agent.key` is a mutation even though its secret result must never enter the ledger.
- HTTP operation and MCP POST reads remain available with the original authentication and company boundaries. Health, operation discovery, records, history, links, search, project context, archives, attachments and deterministic Curator scans remain readable.
- Web page reads use GET/HEAD. The read-only `testKey` POST action on `/setup` and company Admin is also allowed: it checks a model key without saving it. Its URL must contain exactly one `/testKey` action selector; mixed or duplicate selectors are refused. Other web methods/actions are refused before SvelteKit runs them, including JSON chat and future form routes. WebService methods also guard company creation, model-key persistence, accounts, sessions, passwords, resets, settings and Curator controls.
- Company and system SQLite connections open with the SQLite read-only option. Direct company writes, write transactions and schema upgrades are refused too; SQLite also rejects writes attempted through query methods. No setup, directory creation, chmod, or upgrade backup is performed by the read-only database opening paths. SQLite may create or maintain WAL/shared-memory sidecars while opening existing WAL databases; the mode protects logical database contents rather than providing an immutable filesystem mount.
- Both deterministic and model-backed background Curator work are disabled regardless of model keys, auto settings or tick interval. No agent database is opened, initialized or resumed. Historical company records, findings, briefings and duty logs remain readable. Chat transcripts and spend accounting are unavailable in this mode because the existing Curator harness opens writable storage and resumes work even for a chat view.
- Existing API keys, unexpired browser sessions and the existing trusted owner mode continue to work. **New sign-ins and sign-outs are blocked**, along with successful/failed sign-in audit writes, account creation, password changes and resets. An expired browser session cannot be renewed in this mode. Use an existing API key or the already configured trusted local access; do not widen trust to compensate.
- `node src/admin.ts` respects the flag for direct operator writes when launched with the same environment. A server flag cannot prevent an unrelated process launched without it from writing the data directory. This mode is server enforcement, not an OS permission change. No other background writer exists inside this server; the standalone backup script reads source databases and writes separate backups and is not scheduled or changed here.

## Verification in a disposable worktree

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check:web
```

Build before testing: the critical read-only web test requires the real SvelteKit build and fails if it is absent. `node --test test/read-only.test.ts` runs focused coverage. Fixtures use temporary, synthetic data and ephemeral loopback ports; they never open the installed service's data. Coverage checks all registered read/write operations over HTTP and MCP, all current web write form actions and the read-only key-test action in sign-in and trusted modes, chat JSON controls, existing identity/session behavior, direct auth and database methods, deterministic review, scheduled/manual Curator entry points, startup flag parsing, older-schema refusal and direct operator commands. Denied requests are checked against every database table and file hashes, including keys, audit, revisions, links, counters, ledger, settings, agent storage and model-key files.

## Rollback by the release operator

To resume writes on the reviewed code, remove `RS_READ_ONLY` or set it to `0`/`false` in the original process environment and restart at an approved release window. Confirm startup says `read-write` and `/health` reports `"readOnly":false`. Curator timers and any previously pending harness work may resume in write mode. No schema or content rollback is needed: enabling this mode does not migrate or edit database contents.

If reverting the code release, restore the recorded pre-release code and launch configuration under Prime's release procedure. Earlier code does not recognize `RS_READ_ONLY`; reverting it removes write protection even if the flag remains set. Do not mistake an old server for a protected historical server.
