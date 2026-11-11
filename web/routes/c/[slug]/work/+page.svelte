<!-- Work: goals with their projects (finished ones folded), projects without a goal, open assignments and open tasks. -->
<script lang="ts">
  import Avatar from "#lib/Avatar.svelte";
  import { ago, words } from "#lib/fmt.ts";
  import PlanForm from "./PlanForm.svelte";
  let { data, form } = $props();
  type Project = (typeof data.loose)[number];
  const DONE = ["complete", "archived"];
  const live = (ps: Project[]) => ps.filter((p) => !DONE.includes(p.status));
  const finished = (ps: Project[]) => ps.filter((p) => DONE.includes(p.status));
  const allProjects = $derived([...data.goals.flatMap((g) => g.projects), ...data.loose]);
  const activeCount = $derived(allProjects.filter((p) => p.status === "active").length);
  const blocked = $derived(data.tasks.filter((t) => t.status === "blocked"));
  const moving = $derived(data.tasks.filter((t) => t.status === "in_progress"));
  const todo = $derived(data.tasks.filter((t) => t.status === "todo"));
  const SHOW = 6;
  let more = $state<Record<string, boolean>>({});
  const lede = $derived([
    `${data.goals.length} ${data.goals.length === 1 ? "goal" : "goals"}`,
    `${activeCount} active ${activeCount === 1 ? "project" : "projects"}`,
    `${data.tasks.length} open ${data.tasks.length === 1 ? "task" : "tasks"}${blocked.length ? ` (${blocked.length} blocked)` : ""}`,
  ].join(" · "));
</script>

<svelte:head><title>Work · {data.company.name}</title></svelte:head>

{#snippet project(p: Project)}
  <a class="proj" href="/c/{data.slug}/r/{p.key}">
    <span class="p-main">
      <span class="p-title">{p.title}</span>
      <span class="p-sub">
        {#if p.tasks}<span class="prog" style="--f:{p.done / p.tasks}"><i></i></span><span class="tnum">{p.done}/{p.tasks} tasks</span>{:else}<span>No tasks</span>{/if}
        {#if p.entries}<span class="dot">·</span><span class="tnum">{p.entries} {p.entries === 1 ? "entry" : "entries"}</span>{/if}
        <span class="dot">·</span><span>{ago(p.updated_at)}</span>
      </span>
    </span>
    {#if p.status && p.status !== "active"}<span class="chip {p.status}">{words(p.status)}</span>{/if}
  </a>
{/snippet}

{#snippet projects(ps: Project[], id: string)}
  {#if live(ps).length}<div class="list">{#each live(ps) as p (p.id)}{@render project(p)}{/each}</div>{/if}
  {#if finished(ps).length}
    <details class="fold">
      <summary>{finished(ps).length} finished</summary>
      <div class="list">{#each finished(ps) as p (p.id)}{@render project(p)}{/each}</div>
    </details>
  {/if}
{/snippet}

{#snippet tasks(label: string, ts: typeof data.tasks, id: string)}
  {#if ts.length}
    <h3>{label} <span class="tnum dim">{ts.length}</span></h3>
    <div class="list">
      {#each more[id] ? ts : ts.slice(0, SHOW) as t (t.key)}
        <a class="row" href="/c/{data.slug}/r/{t.key}">
          <span class="row-main"><span class="row-title clamp-2">{t.title}</span><span class="row-sub">{t.project || "No project"} · {ago(t.updated_at)}</span></span>
        </a>
      {/each}
    </div>
    {#if ts.length > SHOW && !more[id]}<button class="btn ghost small" onclick={() => (more[id] = true)}>Show {ts.length - SHOW} more</button>{/if}
  {/if}
{/snippet}

<div class="page wide">
  <header class="page-head">
    <h1>Work</h1>
    <p class="lede">{lede}</p>
  </header>
  {#if form?.saved}<p class="notice" role="status">{form.saved}</p>{/if}

  <div class="split">
    <div>
      {#each data.goals as g (g.id)}
        <section class="goal">
          <div class="g-head">
            <span class="g-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z" /></svg></span>
            <div class="g-main">
              <a class="g-title" href="/c/{data.slug}/r/{g.key}">{g.title}</a>
              <span class="g-sub">{live(g.projects).length} open · {finished(g.projects).length} finished</span>
            </div>
            {#if g.status && g.status !== "active"}<span class="chip {g.status}">{words(g.status)}</span>{/if}
          </div>
          {#if g.projects.length}{@render projects(g.projects, g.id)}{:else}<p class="empty">No projects for this goal yet.</p>{/if}
          <div class="under">
            <PlanForm kind="project" action="project_add" goals={data.goals} goal={g.id} statuses={data.statuses} {form} label="Add a project" />
            <PlanForm kind="goal" action="goal_edit" item={g} statuses={data.statuses} {form} label="Edit goal" />
          </div>
        </section>
      {:else}
        <p class="empty">No goals yet. Goals are optional: projects work without one.</p>
      {/each}

      {#if data.loose.length}
        <section class="goal">
          <div class="g-head"><div class="g-main"><span class="g-title">Projects without a goal</span><span class="g-sub">{live(data.loose).length} open · {finished(data.loose).length} finished</span></div></div>
          {@render projects(data.loose, "loose")}
        </section>
      {/if}

      <div class="under new">
        <PlanForm kind="goal" action="goal_add" statuses={data.statuses} {form} label="New goal" />
        <PlanForm kind="project" action="project_add" goals={data.goals} statuses={data.statuses} {form} label="New project" />
      </div>
    </div>

    <aside>
      <div class="section-head"><h2>Assignments</h2><span class="count">{data.assignments.length}</span></div>
      {#if data.assignments.length}
        <div class="list">
          {#each data.assignments as w (w.key)}
            <a class="row" href="/c/{data.slug}/assignments/{w.key}">
              <span class="row-main"><span class="row-title clamp-2">{w.title}</span><span class="row-sub"><Avatar who={w.owner} slug={data.slug} size={16} label /> · {ago(w.updated_at)}</span></span>
              <span class="chip {w.status}">{w.status_words}</span>
            </a>
          {/each}
        </div>
      {:else}<p class="empty">No assignments open.</p>{/if}

      <div class="section-head"><h2>Open tasks</h2><span class="count">{data.tasks.length}</span></div>
      {#if data.tasks.length}
        {@render tasks("Blocked", blocked, "blocked")}
        {@render tasks("In progress", moving, "moving")}
        {@render tasks("To do", todo, "todo")}
      {:else}<p class="empty">No open tasks.</p>{/if}
      <PlanForm kind="task" action="task_add" projects={data.projects} statuses={data.task_statuses} {form} label="Add a task" />
    </aside>
  </div>
</div>

<style>
  .goal { margin: 0 0 26px; }
  .g-head { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; }
  .g-ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: var(--green); background: var(--green-bg); flex: none; }
  .g-ic svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; }
  .g-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .g-title { font-weight: 650; font-size: 17px; letter-spacing: -.012em; text-decoration: none; line-height: 1.3; }
  a.g-title:hover { text-decoration: underline; }
  .g-sub { font-size: 12.5px; color: var(--dim); }
  .proj { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); text-decoration: none; min-height: 56px; }
  .proj:first-child { border-top: 0; }
  .proj:hover { background: var(--card-2); }
  .p-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .p-title { font-weight: 550; line-height: 1.35; }
  .p-sub { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--dim); flex-wrap: wrap; }
  .prog { width: 54px; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; display: inline-block; }
  .prog i { display: block; height: 100%; width: calc(var(--f) * 100%); background: var(--green); border-radius: 3px; }
  .dot { color: var(--faint); }
  .fold > summary { display: inline-flex; align-items: center; min-height: 40px; font-size: 13.5px; font-weight: 550; color: var(--dim); gap: 6px; }
  .fold > summary::before { content: "›"; display: inline-block; transition: transform .15s; }
  .fold[open] > summary::before { transform: rotate(90deg); }
  .under { display: flex; flex-wrap: wrap; gap: 0 4px; align-items: flex-start; }
  .under :global(details[open]) { flex-basis: 100%; }
  .under :global(summary) { font-size: 13.5px; }
  .new { margin-top: -6px; }
  aside h3 { margin-top: 14px; }
</style>
