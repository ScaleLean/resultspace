# Journal SSR hotfix

Branch `fix/journal-legacy-ssr` in the isolated T3 worktree, based directly on current main **897553ba2ad5fc8484f3a86a017932b3ef3acb30**. Apply the single commit containing this handoff; obtain its exact hash with `git log -1 --format=%H -- docs/HANDOFF-JOURNAL-SSR-HOTFIX.md`. No live service/database/sensitive copy, installed profile, main branch or remote was changed. No deployment, merge or push.

The disposable pre-fix SSR regression reproduced HTTP **500** and the exact `EntryRow.svelte:31:35` error on `e.about.title.toLowerCase()`. `journal.list` supplied `about` as a raw record with its title in `body`, while the component expected a top-level title. This also affected ordinary titled records, not only legacy records.

Journal views now add a display title using the existing kind-aware `records.titleOf`, retaining the raw record fields and about key. EntryRow accepts absent about titles and falls back to the key for both comparison and linked label; missing entry type uses the note icon, and unknown legacy types retain the existing generic icon. The stored record, history and links are never normalized or rewritten. No schema/migration/version change or retired workflow.

Critical fixture uses invented historical Journal records with missing/unknown types and about knowledge records with/without stored titles. Final SSR `/c/acme/journal` returns **200**, renders the titled relation and the untitled **KNW-0902** label/link. A real authenticated API and real CLI Journal regression confirms equal results, retained keys/body/type, display titles/key fallback and successful text output. Both compare complete records/revisions/links before and after reads and show no data mutation. No actual live route verification was attempted.

Final checks:

- `npm run build`: passed; final built handler used by SSR tests.
- `npm test`: **57 passed, 0 failed, 0 skipped**, including both new regressions.
- `python3 -m unittest discover -s integrations/hermes-plugin/tests -v`: **6 passed**.
- `npm run check:web`: **0 errors, 0 warnings**.
- `git diff --check`: passed.

Exact changed files: `src/operations/views.ts`, `web/lib/EntryRow.svelte`, `test/fixtures/legacy-journal.ts`, `test/web.test.ts`, `test/cli.test.ts`, `docs/HANDOFF-JOURNAL-SSR-HOTFIX.md`.

Compatibility: `journal.list.about.title` is an additive display field; all existing record fields remain. Stored unknown types stay unknown rather than being silently converted. Apply/rebuild and any live restart belong to the operator's reviewed release process. This local fix does not certify the live pages; independent review and operator-controlled verification remain gates.
