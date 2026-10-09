// Work: goals with their projects, projects without a goal, open tasks and open assignments.
// A project's body.goal_id is the goal's id (not its key); a task's body.project_id likewise.
// Actions: goal_add, goal_edit, project_add, project_edit (fields: title, status, goal = a goal id or ""), task_add (title, status, project = a project id or "").
import { fail_of, need, str } from "#lib/server/rs.ts";
import type { Rec } from "../../../../../src/core/records.ts";
import type { Assignment } from "../../../../../src/operations/assignments.ts";
import type { Actions, PageServerLoad } from "./$types";

const STATUSES = ["planned", "active", "complete", "archived"];
const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"];
const TASK_OPEN = ["todo", "in_progress", "blocked"];
type Plan = { id: string; key: string; title: string; status: string; goal_id: string; entries: number; tasks: number; done: number; updated_at: string };
const text = (v: unknown) => (typeof v === "string" ? v : "");

export const load: PageServerLoad = ({ locals, params }) => {
  const list = (kind: string) => need(locals.rs.run<Rec[]>(params.slug, "record.list", { kind, limit: 1000 }));
  const counts = new Map<string, number>();
  for (const r of list("entry")) { const p = text(r.body.project_id); if (p) counts.set(p, (counts.get(p) ?? 0) + 1); }
  const allTasks = list("task");
  const taskCount = new Map<string, [number, number]>();
  for (const t of allTasks) {
    const p = text(t.body.project_id); if (!p) continue;
    const c = taskCount.get(p) ?? [0, 0]; c[0]++; if (text(t.body.status) === "done") c[1]++; taskCount.set(p, c);
  }
  const plan = (r: Rec): Plan => ({ id: r.id, key: r.key, title: text(r.body.title) || r.key, status: text(r.body.status), goal_id: text(r.body.goal_id), entries: counts.get(r.id) ?? 0,
    tasks: taskCount.get(r.id)?.[0] ?? 0, done: taskCount.get(r.id)?.[1] ?? 0, updated_at: r.updated_at });
  const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key, "en", { numeric: true });
  const goals = list("goal").map(plan).sort(byKey);
  const projects = list("project").map(plan).sort(byKey);
  const known = new Set(goals.map((g) => g.id));
  const names = new Map(projects.map((p) => [p.id, p.title]));
  const tasks = allTasks.filter((t) => TASK_OPEN.includes(text(t.body.status)))
    .map((t) => ({ key: t.key, title: text(t.body.title) || t.key, status: text(t.body.status), project: names.get(text(t.body.project_id)) ?? "", updated_at: t.updated_at })).sort(byKey);
  const assignments = need(locals.rs.run<Assignment[]>(params.slug, "assignment.list", { limit: 100 }));
  return {
    statuses: STATUSES, task_statuses: TASK_STATUSES,
    goals: goals.map((g) => ({ ...g, projects: projects.filter((p) => p.goal_id === g.id) })),
    loose: projects.filter((p) => !known.has(p.goal_id)),
    projects: projects.map((p) => ({ id: p.id, title: p.title })),
    tasks, assignments,
  };
};

type Kind = "goal" | "project" | "task";
const save = (kind: Kind, edit: boolean) => async ({ request, locals, params }: Parameters<Actions[string]>[0]) => {
  const form = await request.formData();
  const ref = str(form, "ref"), title = str(form, "title"), status = str(form, "status"), goal = str(form, "goal"), project = str(form, "project");
  const back = { form: `${kind}_${edit ? "edit" : "add"}`, ref, title };
  if (!title) return fail_of({ ok: false, error: "Give it a title." }, back);
  if (!(kind === "task" ? TASK_STATUSES : STATUSES).includes(status)) return fail_of({ ok: false, error: "Pick a status." }, back);
  const body: Record<string, string | null> = { title, status };
  if (kind === "project") { if (goal) body.goal_id = goal; else if (edit) body.goal_id = null; }
  if (kind === "task" && project) body.project_id = project;
  const r = edit
    ? locals.rs.run<Rec>(params.slug, "record.patch", { ref, set: body })
    : locals.rs.run<Rec>(params.slug, "record.create", { kind, body });
  if (!r.ok) return fail_of(r, back);
  return { saved: `${edit ? "Saved" : "Added"} ${r.result.key}.` };
};

export const actions: Actions = {
  goal_add: save("goal", false), goal_edit: save("goal", true),
  project_add: save("project", false), project_edit: save("project", true),
  task_add: save("task", false),
};
