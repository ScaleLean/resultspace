<!-- The Journal: what happened, newest first, grouped by day. Filter by type, period and project; log an outcome or note at the top. -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import EntryRow from "#lib/EntryRow.svelte";
  import { byDay } from "#lib/fmt.ts";
  let { data, form } = $props();
  let open = $state(false);
  $effect(() => { if (form?.error) open = true; });
  const names = $derived(new Map(data.projects.map((p) => [p.key, p.title])));
  const PERIOD: Record<string, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
  const TYPE: Record<string, string> = { "": "All", outcome: "Outcomes", action: "Actions", note: "Notes", session: "Sessions" };
  const link = (o: { since?: string; type?: string; project?: string }) => {
    const p = new URLSearchParams({ since: o.since ?? data.since });
    const t = o.type ?? data.type, pr = o.project ?? data.project;
    if (t) p.set("type", t); if (pr) p.set("project", pr);
    return `?${p}`;
  };
  const groups = $derived(byDay(data.entries, (e) => e.at));
</script>

<svelte:head><title>Journal · {data.company.name}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <h1>Journal</h1>
    <p class="lede">What happened, as the agents and you wrote it: {data.counts[""] ?? 0}{data.capped ? "+" : ""} entries in the last {PERIOD[data.since]}{data.counts.session ? `, plus ${data.counts.session}${data.capped ? "+" : ""} agent sessions` : ""}.</p>
  </header>

  <form method="POST" action="?/log" class="card composer" use:enhance={() => async ({ update, result }) => { await update({ reset: result.type === "success" }); if (result.type === "success") open = false; }}>
    {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
    {#if form?.saved}<p class="notice" role="status">{form.saved}</p>{/if}
    <div class="line">
      <input name="title" required maxlength="300" placeholder="Log what happened…" aria-label="What happened" value={form?.title ?? ""} onfocus={() => (open = true)} />
      <button class="btn primary">Log</button>
    </div>
    {#if open}
      <div class="more">
        <label class="field"><span>Type</span><select name="type"><option value="outcome">Outcome: what changed or is now true</option><option value="note">Note</option></select></label>
        <label class="field"><span>Project</span>
          <select name="project"><option value="">No project</option>{#each data.projects as p}<option value={p.key} selected={p.key === data.project}>{p.title}</option>{/each}</select>
        </label>
        <label class="field full"><span>Detail (optional)</span><textarea name="detail" rows="3" maxlength="8000">{form?.detail ?? ""}</textarea></label>
      </div>
    {/if}
  </form>

  <nav class="filters" aria-label="Type">
    {#each Object.keys(TYPE) as t}
      <a class="chip" class:on={data.type === t} href={link({ type: t })} aria-current={data.type === t ? "true" : undefined}>{TYPE[t]} <span class="n">{data.counts[t] ?? 0}{data.capped ? "+" : ""}</span></a>
    {/each}
  </nav>
  <div class="bar">
    <nav class="seg" aria-label="Period">
      {#each Object.keys(PERIOD) as s}<a class:on={data.since === s} href={link({ since: s })} aria-current={data.since === s ? "true" : undefined}>{PERIOD[s]}</a>{/each}
    </nav>
    {#if data.projects.length}
      <form method="GET" class="pick">
        <input type="hidden" name="since" value={data.since} />
        {#if data.type}<input type="hidden" name="type" value={data.type} />{/if}
        <select name="project" aria-label="Project" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">All projects</option>
          {#each data.projects as p}<option value={p.key} selected={p.key === data.project}>{p.title}</option>{/each}
        </select>
        <noscript><button class="btn small">Show</button></noscript>
      </form>
    {/if}
  </div>

  {#if data.entries.length}
    {#each groups as g}
      <div class="section-head"><h2>{g.day}</h2><span class="count">{g.rows.length}</span></div>
      <div class="list">{#each g.rows as e (e.key)}<EntryRow slug={data.slug} {e} projects={names} />{/each}</div>
    {/each}
  {:else}
    <p class="empty">Nothing in the Journal for this period{data.type ? ` of this type` : ""}.</p>
  {/if}
</div>

<style>
  .composer { padding: 10px; }
  .line { display: flex; gap: 8px; }
  .line input { flex: 1; min-width: 0; border-color: transparent; background: var(--card-2); }
  .more { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; margin-top: 12px; }
  .more .full { grid-column: 1 / -1; }
  @media (max-width: 560px) { .more { grid-template-columns: 1fr; } }
  .filters { margin-top: 6px; }
  .bar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
  .seg { display: inline-flex; background: var(--hover); border-radius: 10px; padding: 3px; gap: 2px; }
  .seg a { min-height: 38px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 8px; text-decoration: none; font-size: 13.5px; font-weight: 500; color: var(--ink-2); }
  .seg a.on { background: var(--card); color: var(--ink); box-shadow: var(--shadow); font-weight: 600; }
  .pick { flex: 1; min-width: 180px; display: flex; gap: 8px; }
  .pick select { flex: 1; min-width: 0; }
</style>
