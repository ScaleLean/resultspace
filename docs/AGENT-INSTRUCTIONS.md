# Read focused context, work, record sourced learning

1. Use the configured company and its own API key. Check `rs whoami`; never fall back to another company's identity.
2. Read `rs brief`, then `rs project context KEY --json`. Read relevant fact/source records and contradiction findings before relying on claims. Use company search when focused context is insufficient.
3. Work using your own runtime and tools. ResultSpace does not approve, authorize, assign or execute work. Issue notes are unassigned planning context.
4. Record what changed or what you learned with `rs log "Outcome" --project KEY --type learning --text "Evidence and limits" --source "Citation"`. Write longer sourced method learnings as knowledge pages linked to the project.
5. Change project state or factual claims explicitly with `rs set KEY ... --why "Source and reason"`. Preserve uncertainty and conflicting evidence. Do not call a claim verified without independent support.

API/MCP equivalents: `project.context` / `project_context`, `record.get` / `record_get`, `record.search` / `record_search`, `journal.log` / `journal_log`. The Hermes plugin exposes `rs_context` and `rs_learn`. There is no claim/dispatch/permission/approval/skill-sync API. Do not install or modify Hermes SKILL.md from ResultSpace.

Curator findings are suggestions backed by evidence. A flag never changes a claim or authorizes an action. Corrections require explicit author revisions and sources.
