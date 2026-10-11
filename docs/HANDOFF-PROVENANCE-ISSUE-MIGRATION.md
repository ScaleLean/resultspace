# Provenance and legacy issue migration handoff

## Latest review follow-up: immutable Journal anchors and client identity

Implementation **b3adbca075f2f2816cab173a7ccd741950f07c4d**, based on **452e4a12cefd92ecfe9cf78cb3f85953915bf0da**. This supersedes the older instructions below about repairing Journal scope through link edits: `project_id` and `about_id` are immutable after creation, including absent/historical values. Corrections append a new attributed entry. Core patch validation also covers undo; archive/restore preserves bodies. No migration/version bump: schema remains 6. Ordinary content/citation edits and historical readback remain available.

Disposable authenticated HTTP regression covers parent/child/transitive child; rejected moves, deletions and attempted cycles; contradictory/forward-parent creation; content edit/undo; rejected undo of a historical scope revision; archive undo and restore; and visibility in original project context/Log throughout. Existing migration regression confirms conflicting historical anchors remain unchanged while content editing succeeds. Retained links test still checks citation rebuilding and mutable knowledge references while explicitly rejecting Journal scope removal.

Named Hermes profiles now select only their own config path and fail closed when absent; `default` uses base config, even if a profiles/default config exists. `RS_CONFIG` explicitly overrides either. A regression places a valid default config beside a missing named profile and verifies rejection; exact actor/company readback and recorded revision identity are checked for default and explicit override. No installed configs/profiles were edited.

Final verification on this implementation: `npm run build` passed; `npm test` **53 passed, 0 failed, 0 skipped**, using the rebuilt web handler; `npm run check:web` **0 errors, 0 warnings**; `python3 -m unittest discover -s integrations/hermes-plugin/tests -v` **6 passed**; `git diff --check` passed. Runtime and tests are committed together. Nine files changed, 140 lines added/16 deleted; no files or retained tests removed. [Exact file manifest](CHANGED-FILES-PROVENANCE-ISSUE-MIGRATION.txt) includes this follow-up.

Release remains blocked pending independent review and actual eight-company disposable backup/restore/client/rollback gates. No live or sensitive copy reads, installed-client changes, push, merge or deployment. Prior implementation/handoff details below are historical.

Implementation: **ac9a74ea6885ee272a3d2ef7027a33af93f8fc4c**, based on **c4682ab696cd470c4a3258aa707d8e24b31a763d**, in the existing isolated knowledge-first worktree. [Exact changed files](CHANGED-FILES-PROVENANCE-ISSUE-MIGRATION.txt). No main/remote/live-data/installed-profile changes, deployment or merge. No sensitive backup contents were opened. Tests use synthetic disposable company directories.

| Before | After |
| --- | --- |
| Journal about/project can disagree; backlinks can contaminate another project's log | One core project scope, validated on writes and resolved on historical reads; conflicts reported outside focused logs |
| Fact title/source editor credited with value assertion | Revision-derived assertion, separate last-edit/citation provenance and original body/actor/time in context and web |
| Legacy schema-4 `issue`/`ISS` blocks migration or risks semantic conversion | Schema 6 archives original records verbatim; new unassigned `issue_note`/`ISN`, still displayed as Issues |

Canonical scope rules and claim-defining fields are documented in [the invariant](PROJECT-CLAIM-PROVENANCE.md). HTTP and CLI regressions reject mismatched Journal create/log/patch for project and scoped claims; deliberate shared fact/knowledge citations do not copy logs. Moving a scoped claim into another project is refused while Journal explicitly anchors it to the prior one. Historical missing/conflicting links remain stored unchanged; conflicts remain key-readable in Log/history and are surfaced separately in project context. Filtering occurs before pagination, with no updated-time pre-cap.

The two-actor assertion regression checks original creation, value edit, title-only metadata, source-only citation, citation undo, value undo and changes/undo to subject/property/type/scope/unit/observation date. HTTP-backed web readback shows the second actor as value asserter and first actor as subsequent metadata/citation editor, plus original value. Existing schema-2 knowledge and prior disposable schema-5 fact histories retain this distinction after migration, deriving from actual revision bodies even when historical `changed` lists are empty.

The explicit schema-4 fixture has kind `issue`, prefix `ISS`, four invented records, IDs/keys, two revisions each and project links. Migration preserves these tables byte-for-byte and exposes old-key/history reads through the read-only archive. New notes create `ISN-0001` independently. Tests exercise another company, post-upgrade backup/restore and schema-4 rollback. Schemas 2/3/4 directly upgrade to 6; prior disposable 5 also upgrades to 6, archiving its issue identity unchanged. Collisions with `fact`/`FCT` or `issue_note`/`ISN` still abort atomically. [Migration semantics and operator procedure](deploy/MIGRATION.md).

Final checks on the implementation tree:

- `npm run build`: exit 0, built SvelteKit handler used by web tests.
- `npm test`: **52 passed, 0 failed, 0 skipped** (46 existing application tests retained, six added). Includes authenticated isolation/history, API+CLI path, >1000-edited-Journal pagination, Curator contradiction/evidence and bounded baseline, schema 2/3/4/5, collision rollback, backup/restore and representative web author/read paths.
- `npm run check:web`: exit 0, **0 errors, 0 warnings**. An initial component prop typing diagnostic was fixed and the final build/check rerun.
- `python3 -m unittest discover -s integrations/hermes-plugin/tests -v`: **5 passed**. Includes missing/wrong/revoked key, unreachable server, missing/malformed profile configuration, exact authenticated identity and company wall.
- `git diff --check`: exit 0.

Implementation changed 31 files, adding 453 and deleting 130 lines (gross diff counts, including renamed identities and map formatting). No complete code/test files or retained tests were deleted in this fix. Earlier aggressive feature-removal measurements are in the original handoff; no retired workflow machinery was restored.

Compatibility/data risks: generic callers must change new-note kind from `issue` to `issue_note`; no alias or lifecycle compatibility was added. Schema-5 notes retain their old keys in archive, with new notes starting the new prefix. Old server code must use a restored original-schema backup, never schema 6. Historical contradictory Journal links need explicit human correction; they are not silently rewritten. Canonical scope resolution scans candidate Journal records before limiting, so very large logs may need later query optimization. Assertion attribution reads revision history; source text remains supplied evidence, not external verification. Original Curator evidence snapshots are preserved, not retroactively rewritten.

**Release remains blocked.** Next gate: fresh independent review of this implementation plus operator rerun of the actual quiesced whole-directory backup into a new disposable restore, all eight company migrations/preservation checks, copied-credential and client smoke paths, and rollback using original code. The reported healthy live restart was not an upgrade. Coordinate the default plugin 0.14.0 and default plus seven named retired-memory configurations using [the installed-client plan](deploy/INSTALLED-CLIENT-MIGRATION.md); this turn made no installed-client changes. Synthetic tests do not certify the sensitive backup.
