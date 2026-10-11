export const priorKinds = [
  { kind: "company", prefix: "CO", title_field: "name", statuses: null, refs: {} },
  { kind: "goal", prefix: "GOAL", title_field: "title", statuses: ["planned", "active", "complete", "archived"], refs: {} },
  {
    kind: "project",
    prefix: "PRJ",
    title_field: "title",
    statuses: ["planned", "active", "complete", "archived"],
    refs: { goal_id: "goal" },
  },
  {
    kind: "task",
    prefix: "TSK",
    title_field: "title",
    statuses: ["todo", "in_progress", "blocked", "done", "cancelled"],
    refs: { project_id: "project", artifact_ids: "artifact" },
  },
  // A file: its bytes are an attachment (blob) named by `sha256`.
  { kind: "artifact", prefix: "ART", title_field: "title", statuses: null, refs: {} },
  // The Journal: what happened. One kind, four types: outcome (what changed or is now true), action (an
  // outward action an agent took: spend, ads, publish...), session (what an agent session did), note.
  // `about_id` is the record it is about, when there is one; `assignment_id` the assignment it was done under.
  {
    kind: "entry",
    prefix: "JNL",
    title_field: "title",
    statuses: null,
    refs: { about_id: null, project_id: "project", assignment_id: "assignment" },
  },
  // An outcome handed to one agent: brief, owner, optional project and due date, lifecycle status, the result the
  // agent reports, and (separately) whether a person verified it. Not a project (a body of work) and not a task (a to-do).
  {
    kind: "assignment",
    prefix: "ASG",
    title_field: "title",
    statuses: ["queued", "picked_up", "in_progress", "needs_permission", "done", "failed", "cancelled"],
    refs: { project_id: "project" },
  },
  // The Curator's work product. A flag is a finding about a record. A request is a change that waits for a
  // person. A briefing is the daily summary for a person.
  { kind: "flag", prefix: "FLG", title_field: "title", statuses: ["open", "fixed", "dismissed"], refs: { about_id: null, other_id: null } },
  { kind: "request", prefix: "REQ", title_field: "title", statuses: ["open", "approved", "declined"], refs: { about_id: null } },
  { kind: "briefing", prefix: "BRF", title_field: "title", statuses: null, refs: {} },
  { kind: "knowledge", prefix: "KNW", title_field: "title", statuses: null, refs: {} },
  { kind: "source", prefix: "SRC", title_field: "title", statuses: null, refs: {} },
  { kind: "decision", prefix: "DEC", title_field: "title", statuses: null, refs: {} },
  // How we do things. A skill cites the knowledge it depends on, so a change there reaches the skill.
  { kind: "skill", prefix: "SKL", title_field: "title", statuses: ["draft", "active", "retired"], refs: { knowledge_ids: "knowledge" } },
];
