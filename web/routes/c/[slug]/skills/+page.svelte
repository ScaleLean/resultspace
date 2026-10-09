<!-- Skills: how we do things. Own skills first, then the shared ones (read-only here). Search, filter by status, add one. -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import { ago, words } from "#lib/fmt.ts";
  let { data, form } = $props();
  type Skill = (typeof data.own)[number];
  const link = (status: string) => { const p = new URLSearchParams(); if (data.q) p.set("q", data.q); if (status) p.set("status", status); return `?${p}`; };
  const LABEL: Record<string, string> = { "": "All", draft: "Draft", active: "Active", retired: "Retired" };
</script>

<svelte:head><title>Skills · {data.company.name}</title></svelte:head>

{#snippet skill(s: Skill)}
  <a class="row" href="/c/{data.slug}/skills/{s.key}{s.shared ? "?shared=1" : ""}">
    <span class="row-main">
      <span class="row-title">{s.title}{#if s.shared} <span class="chip">shared</span>{/if}</span>
      {#if s.when}<span class="row-sub">Use when: {s.when}</span>{/if}
      <span class="row-sub">{s.key}{#if s.knowledge.length} · depends on {s.knowledge.map((k) => k.key).join(", ")}{/if} · {ago(s.updated_at)}</span>
    </span>
    <span class="chip {s.status}">{words(s.status)}</span>
  </a>
{/snippet}

<div class="page">
  <h1>Skills</h1>
  <form method="GET" class="search" role="search">
    {#if data.status}<input type="hidden" name="status" value={data.status} />{/if}
    <input type="search" name="q" value={data.q} placeholder="Search title and when-to-use" aria-label="Search skills" />
    <button class="btn">Search</button>
  </form>
  <nav class="filters" aria-label="Status">
    {#each Object.keys(LABEL) as s}<a class="chip" class:on={data.status === s} href={link(s)} aria-current={data.status === s ? "true" : undefined}>{LABEL[s]}</a>{/each}
  </nav>
  {#if form?.saved}<p class="notice" role="status">{form.saved}</p>{/if}

  <div class="section-head"><h2>Our skills</h2><span class="count">{data.own.length}</span></div>
  {#if data.own.length}
    <div class="list">{#each data.own as s (s.key)}{@render skill(s)}{/each}</div>
  {:else}<p class="empty">{data.q || data.status ? "No skill of ours matches." : "No skills of our own yet. Add the first one below."}</p>{/if}

  {#if data.shared.length}
    <div class="section-head"><h2>Shared skills</h2><span class="count">{data.shared.length}</span><span class="muted">read-only here</span></div>
    <div class="list">{#each data.shared as s (s.key)}{@render skill(s)}{/each}</div>
  {/if}

  <details class="new" open={!!form?.error}>
    <summary>New skill</summary>
    <form method="POST" action="?/add" class="card" use:enhance={() => async ({ update, result }) => { await update({ reset: result.type === "success" }); }}>
      {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
      <label class="field"><span>Title</span><input name="title" required maxlength="300" value={form?.title ?? ""} /></label>
      <label class="field"><span>Use when</span><input name="when" maxlength="500" value={form?.when ?? ""} placeholder="The situation this skill is for" /></label>
      <label class="field"><span>Body (markdown)</span><textarea name="body" rows="10" value={form?.body ?? ""}></textarea></label>
      <label class="field"><span>Status</span><select name="status">{#each data.statuses as s}<option value={s}>{words(s)}</option>{/each}</select></label>
      <label class="field"><span>Knowledge it depends on (keys, comma-separated)</span>
        <input name="knowledge" value={form?.knowledge ?? ""} placeholder="KNW-0001, KNW-0002" list="knowledge-keys" />
        <datalist id="knowledge-keys">{#each data.knowledge as k}<option value={k.key}>{k.title}</option>{/each}</datalist>
      </label>
      <div class="actions"><button class="btn primary">Add skill</button></div>
    </form>
  </details>
</div>

<style>
  .search { display: flex; gap: 8px; margin: 0 0 10px; }
  .search input { flex: 1; min-width: 0; min-height: 44px; font: inherit; font-size: 16px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--ink); }
  .filters { margin-bottom: 12px; }
  .row-title .chip { margin-left: 6px; font-weight: 500; }
  .row-sub { overflow: visible; white-space: normal; }
  .section-head .muted { font-size: 12.5px; }
  .new { margin-top: 18px; }
  .new > summary { display: inline-flex; align-items: center; min-height: 44px; cursor: pointer; font-weight: 600; color: var(--dim); }
  .new form { display: grid; gap: 10px; margin-top: 6px; }
  .new textarea { width: 100%; font: 13px ui-monospace, Menlo, monospace; }
</style>
