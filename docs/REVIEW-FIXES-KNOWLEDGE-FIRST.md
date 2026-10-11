# Independent-review remediation handoff

Release remains blocked. Independent review rejected the first implementation; this follow-up addresses only the listed findings and awaits re-review. Work stays on `feat/knowledge-first-resultspace`, descended from clean main `9ca7120`.

Fix commit: `16262def61f46fb67048af1777d36c131b485049` — Fix reviewed provenance, evidence, pagination and initial accuracy checks.
This verification document is the following documentation commit; `git log -2 --format='%H %s'` shows both exact hashes.

No live company data, installed Hermes plugin/profile/skill, interrupted worktree, main or remote was accessed or modified. No push, merge, deployment or live restart. All server/data/key/profile verification fixtures were disposable.

## Specific regressions

| Review finding | Fix and verified regression |
| --- | --- |
| P1 mutable Log content credited to original writer | Current title/type/detail credit the last editor, with current revision/edit time; `original` returns the creation actor/body/time separately and append-only history remains. Real API test uses two distinct authenticated member keys to invert an outcome into a note; project context and `journal.list` agree on editor/content/time, and original outcome/history remain. Web test creates learning as Alex, edits it through a second member key, then reads current content/editor through Log and project context and the original through history. |
| P2 creation-time pagination | SQL filters type/project/creation timestamp and sorts creation time/key before applying the requested limit; no updated-time pre-cap. Disposable regression creates 1,002 entries, edits all 1,001 older entries afterward, and still retrieves the newest-created event. Project/type/since filters remain correct; ISO times normalize before comparison. |
| Unsourced learning | Shared core create/patch validation requires a nonblank citation or a current source record for `type=learning`. API rejects missing/whitespace sources and generic note-to-learning patches; real CLI and web reject uncited learning. Existing learning stays readable when its cited source is archived; deterministic scan flags it unsupported. Source text remains an author citation, never independent verification. |
| Source inventory | Context deduplicates direct project sources and citations on related claims. Test cites a source solely on a linked fact, then shares it with knowledge/log and checks one inventory entry; archived sources are omitted from current inventory. The web project renders a Sources section, with a fact-only source regression. |
| Initial model accuracy | Fixed revision high-water mark and persisted cursor initialized atomically, with at most 20 existing facts/knowledge per review call. Daily spending preflight applies; skipped/failed duties do not advance. Controlled-model test seeds 23 imported facts/knowledge and the previous skip cursor, checks a spend-gated no-call/no-advance, batches 20 then 3 across restart, and processes a later claim incrementally without repeating completed baseline claims. |
| Client failure/identity | Five plugin test groups exercise missing/unconfigured/empty/insecure keys, wrong/revoked key HTTP 401, unreachable-server status 0, absent/malformed/invalid typed profile config, exact default/named-profile company and actor kind/name/role, and server attribution on explicit writes. Real disposable server; no installed Hermes runtime changes. |

## Final checks on the fix commit

| Command | Result |
| --- | --- |
| `npm run build` | Passed, production SvelteKit adapter-node build |
| `npm test` | TypeScript check plus **46 passed**, 0 failures/skips |
| `npm run check:web` | **0 errors, 0 warnings** |
| `python3 -m unittest discover -s integrations/hermes-plugin/tests -v` | **5 passed** |
| `git diff 3bb7196 HEAD --check` and staged diff check | Passed |

No retained tests were deleted. Four application regressions were added; existing API/CLI/web coverage was expanded. Model accuracy tests use the real Curator harness with controlled responses, not paid/live model calls. Installed Hermes runtime smoke testing has not occurred.

## Coordinated client plan and remaining gates

[Installed-client migration plan](deploy/INSTALLED-CLIENT-MIGRATION.md) records the reported installed default plugin **0.14.0**, default plus **seven named configurations** using `resultspace-memory`, target server **0.4.0** / plugin **0.15.0**, and replacements for `rs_recall` / `rs_remember` / `rs_act` / `rs_work`. It requires preserving configuration/key/memory copies, identifying the exact eight configurations and authenticated identities, selecting a supported runtime memory provider, and rehearsing all eight client/provider read-record-failure smoke paths in disposable copies before a coordinated future cutover. The seven names were not supplied and have not been guessed or discovered from installed profiles in this turn.

Independent re-review and a consistent quiesced live backup/restore rehearsal remain required. The client/provider upgrade plan must also pass its disposable tests before release. No gate is claimed complete here. Initial model review is bounded by claim batches and the existing preflight daily spending gate; it is not a hard mid-conversation cost cutoff.

## Exact changed files

Fix commit relative to `3bb71965b3724b38cbca37730883031cddb89517` (M modified, A added):

```text
M	docs/HANDOFF-KNOWLEDGE-FIRST.md
A	docs/deploy/INSTALLED-CLIENT-MIGRATION.md
M	docs/deploy/MIGRATION.md
M	docs/design/KNOWLEDGE-FIRST.md
M	integrations/hermes-plugin/README.md
M	integrations/hermes-plugin/resultspace/rsclient.py
M	integrations/hermes-plugin/tests/test_knowledge.py
M	src/core/context.ts
M	src/core/records.ts
M	src/curator/curator.ts
M	src/curator/scan.ts
M	src/operations/views.ts
M	test/api.test.ts
M	test/cli.test.ts
M	test/curator.test.ts
M	test/knowledge.test.ts
M	test/web.test.ts
M	web/lib/Author.svelte
M	web/lib/EntryRow.svelte
M	web/routes/c/[slug]/r/[key]/+page.svelte
```

The following documentation commit adds only `docs/REVIEW-FIXES-KNOWLEDGE-FIRST.md`. The [original changed-file manifest](CHANGED-FILES-KNOWLEDGE-FIRST.txt) remains the historical record for the initial redesign.
