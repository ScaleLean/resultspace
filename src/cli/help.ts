export const HELP = `ResultSpace — company and project knowledge

rs brief                         Company brief and projects
rs project context PRJ-0001       Focused context with sources and evidence
rs new project title="Launch" goal="..." objectives:='["..."]' current_state="..."
rs new fact --body '{"title":"Lead time","subject":"Supplier A","predicate":"lead_time","value_type":"number","value":4,"unit":"weeks","source":"Supplier email dated ..."}'
rs new knowledge title="Learning" body="..." source="..." project_id=PRJ-0001
rs new issue_note title="Review packaging" project_id=PRJ-0001 status=open
rs log "What changed" --project PRJ-0001 --type learning --text "..." --source "..."
rs ls KIND | show KEY | set KEY field=value | search "words" | context KEY
rs journal [--project KEY]        Meaningful log
rs history KEY | activity         Server-attributed history
rs curator scan | review          Evidence candidates; review records flags only
rs legacy                        Read-only retired records; show/history KEY still work
rs archive KEY | restore KEY      Retained knowledge records only
rs kinds | knowledge | status
rs whoami | companies | doctor
rs init --server URL --company SLUG --key-file FILE
rs agents ls | add NAME | key NAME --out FILE | revoke NAME

-C/--company SLUG, --profile NAME, --json, --limit N
Use field:=JSON for typed values and arrays; field=null removes a field.
0.4.0 cutoff: assignment/work/task/action/permission/presence/approval/skill-sync
commands and operations are removed. Upgrade clients and plugins together.
ResultSpace stores knowledge and planning notes. Your runtime owns tools and execution.`;
export const TOPICS: Record<string, string> = { project: HELP, facts: HELP, curator: HELP, legacy: HELP };
