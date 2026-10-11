# Schema 5 migration and rollback rehearsal

Release gate: independent review plus a consistent whole-server backup/restore rehearsal from live data into disposable copies. This worktree has not performed that live rehearsal and must not be deployed or merged yet.

## Preserved data

Schemas 2, 3 and 4 upgrade directly to 5 in one transaction. Every record's current kind/body/id/key/revision/author/time/archive state stays verbatim. Revisions, links, search rows, blobs, agents, hashed keys, counters and operation outcomes remain. No user rows are deleted. Kind definitions stay in the database; supported built-in reference fields are added, retaining prior company-specific references.

`legacy_records` maps retired/custom kinds and raw session/action entries to a read-only archive. API writes and a SQLite trigger refuse edits, archive/restore and undo. Original keys resolve for reading, links and full history. Presence and evidence-authority tables become `legacy_presence` and `legacy_evidence_authority`, with their rows preserved and writes disabled. Assignments, tasks, goals, approvals and separate skills are not automatically converted into new planning notes or trusted claims.

When a schema 2/3/4 file is opened with the correct slug, `Company.open` writes a mode-0600 consistent SQLite snapshot named `<slug>.sqlite.pre-schema-5-<timestamp>.backup` before migration. Migration conflicts (such as an existing FCT prefix) abort atomically; review a disposable copy and choose a mapping before retrying. This snapshot covers only that company file, not accounts, Curator conversations or external runtime configuration.

## Disposable rehearsal

The commands below describe an operator-run procedure. Do not execute them on live data without the reviewed release process. Stop every server and external writer first; `--quiesced` asserts this condition. A backup of independently changing SQLite files is not a consistent whole-server backup.

```sh
node scripts/data-rehearsal.ts backup /path/to/quiesced-data /new/backup-copy --quiesced
node scripts/data-rehearsal.ts restore /new/backup-copy /new/rehearsal-data
DATA_DIR=/new/rehearsal-data RS_CURATOR_AUTO=off node src/admin.ts company list
```

Backup uses SQLite `VACUUM INTO` (including committed WAL), checks database integrity, copies flat server-owned files with restrictive modes, and writes a SHA-256 manifest. Restore verifies every listed file and database, and accepts only a new destination. It never overwrites live files. Preserve external CLI key files, installed runtime/profile configuration and the prior release separately; they are outside the server data directory. Unsupported nested directories stop the backup for explicit scope review.

On the disposable restored directory, check company isolation, old and new record keys, full revision bodies, source links, credentials, attachments and operation counts. Authenticate with copied keys; compare schema 2/3/4 records to the pre-upgrade backup. Read focused project context, write sourced learning via API/CLI, and author/read a representative project and fact in the web UI. Record exact commands, counts and release commit hashes.

## Rollback

Keep the complete pre-upgrade backup and prior code/dependencies. Restore the backup into a separate new directory and verify its original schema version and data before any cutover. Old code must use those original schema files; it must never open schema 5 data. Rehearse authentication and old-key reads under the prior release. Preserve any schema 5 writes made after cutover as a separate evidence copy: restoring a pre-upgrade backup does not include later writes.

The automated tests rehearse migration, preserved rows, complete directory backup/restore, credential/account sessions and rollback on disposable fixtures. They do not substitute for the live-data rehearsal.

## Client cutoff

Server 0.4.0 removes assignment/work, permission/action, presence/receipt, approval and skill-repository operations. There are no inert success responses or compatibility task handlers. Retired calls return not-found, with an upgrade explanation for retired operation families. Upgrade to focused context and explicit sourced record writes, and use plugin 0.15.0. Retired web views return 404; archived keys open through `/c/<slug>/r/<key>`.

Installed Hermes profiles and skills have not been changed. If an installed profile still uses the retired `resultspace-memory` provider, replace it with a supported runtime memory provider during the reviewed upgrade. Long-term skill ownership remains undecided.
