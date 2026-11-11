<!-- The small add / edit form for a goal, project or task on the Work page. Folded in a <details>.
     <PlanForm kind="project" action="project_edit" item={p} goals={data.goals} statuses={data.statuses} {form} goal={g.id} />
     <PlanForm kind="task" action="task_add" projects={data.projects} statuses={data.task_statuses} {form} /> -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import { words } from "#lib/fmt.ts";
  type Item = { key: string; title: string; status: string; goal_id?: string };
  type Back = { form?: string; ref?: string; title?: string; error?: string } | null | undefined;
  let { kind, action, item, goals = [], projects = [], statuses, form, goal = "", label }: {
    kind: "goal" | "project" | "task"; action: string; item?: Item; goals?: { id: string; title: string }[]; projects?: { id: string; title: string }[]; statuses: string[]; form: Back; goal?: string; label?: string;
  } = $props();
  // The error belongs to this form only when it was the one sent.
  const mine = $derived(form?.form === action && (form?.ref ?? "") === (item?.key ?? "") && !!form?.error);
  const status = $derived(item?.status || (kind === "task" ? "todo" : "active"));
  const picked = $derived(item ? (item.goal_id ?? "") : goal);
</script>

<details class="plan-form" class:edit={!!item} open={mine}>
  <summary>{label ?? (item ? "Edit" : `Add a ${kind}`)}</summary>
  <form method="POST" action="?/{action}" class="card" use:enhance={() => async ({ update, result }) => { await update({ reset: result.type === "success" }); }}>
    {#if mine}<p class="error" role="alert">{form?.error}</p>{/if}
    {#if item}<input type="hidden" name="ref" value={item.key} />{/if}
    <label class="field"><span>Title</span><input name="title" required maxlength="300" value={mine ? form?.title ?? "" : item?.title ?? ""} /></label>
    <label class="field"><span>Status</span>
      <select name="status">{#each statuses as s}<option value={s} selected={s === status}>{words(s)}</option>{/each}</select>
    </label>
    {#if kind === "project"}
      <label class="field"><span>Goal</span>
        <select name="goal"><option value="">No goal</option>{#each goals as g}<option value={g.id} selected={g.id === picked}>{g.title}</option>{/each}</select>
      </label>
    {:else if kind === "task"}
      <label class="field"><span>Project</span>
        <select name="project"><option value="">No project</option>{#each projects as p}<option value={p.id}>{p.title}</option>{/each}</select>
      </label>
    {/if}
    <div class="actions"><button class="btn primary">{item ? "Save" : "Add"}</button></div>
  </form>
</details>

<style>
  .plan-form { margin: 0 0 8px; }
  summary { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 10px; border-radius: 9px; cursor: pointer; color: var(--dim); font-size: 13.5px; font-weight: 550; }
  summary::before { content: "+"; font-weight: 500; font-size: 16px; line-height: 1; }
  .edit summary::before { content: "✎"; font-size: 13px; }
  summary:hover { color: var(--ink); background: var(--hover); }
  .edit { margin: 0; }
  form { margin: 4px 0 8px; }
</style>
