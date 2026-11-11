<!-- One record of any kind: what it says, what it is linked to, how it changed, and the few things the owner can do. -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import Avatar from "#lib/Avatar.svelte";
  import EntryRow from "#lib/EntryRow.svelte";
  import Fields from "#lib/Fields.svelte";
  import TypeIcon from "#lib/TypeIcon.svelte";
  import RecRow from "#lib/RecRow.svelte";
  import Text from "#lib/Text.svelte";
  import { ago, when, words } from "#lib/fmt.ts";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const rec = $derived(data.rec);
  const status = $derived(typeof rec.body.status === "string" ? rec.body.status : "");
  const label = (k: string) => { const w = words(k); return w.charAt(0).toUpperCase() + w.slice(1); };
  const isLong = (v: string) => v.length > 80 || v.includes("\n");
  const opWords = (op: string) => words(op.replace(/^record\./, "").replace(/\./g, " "));
  let allHistory = $state(false);
  const shown = $derived(allHistory ? data.history : data.history.slice(0, 4));
</script>

<svelte:head><title>{data.title} · {rec.key}</title></svelte:head>

<div class="page wide">
  <header class="page-head rec-head">
    <div class="eyebrow"><TypeIcon type={rec.kind === "entry" ? String(rec.body.type ?? "note") : rec.kind} size={24} /><span>{words(rec.kind === "entry" ? `${rec.body.type ?? "note"} entry` : rec.kind)}</span><span class="mono dim">{rec.key}</span></div>
    <h1>{data.title}</h1>
    <div class="meta">
      {#if status}<span class="chip {status}">{words(status)}</span>{/if}
      {#if rec.archived}<span class="chip archived">archived</span>{/if}
      <Avatar who={rec.updated_by} slug={data.slug} size={18} label />
      <span class="dim">changed {ago(rec.updated_at)}</span>
    </div>
  </header>

  {#if form && "error" in form && form.error}<p class="error">{form.error}</p>{/if}
  {#if form && "ok" in form && form.ok}<p class="notice">{form.ok}</p>{/if}

  <div class="split">
    <div>
      <div class="card body">
        <Fields body={rec.body} slug={data.slug} skip={[data.titleField, "status", ...(rec.kind === "entry" ? ["type"] : [])]} />
      </div>

      {#if rec.kind === "goal"}
        <div class="section-head"><h2>Projects</h2><span class="count">{data.projects.length}</span></div>
        {#if data.projects.length}
          <div class="list">{#each data.projects as p (p.key)}<RecRow slug={data.slug} rec={p} />{/each}</div>
        {:else}<p class="empty">No projects under this goal yet.</p>{/if}
      {/if}

      {#if rec.kind === "project"}
        <div class="section-head"><h2>Journal</h2><span class="count">{data.entries.length}</span><a href="/c/{data.slug}/journal?since=30d&project={rec.key}">All →</a></div>
        {#if data.entries.length}
          <div class="list">{#each data.entries as e (e.key)}<EntryRow slug={data.slug} {e} showDay here={rec.key} />{/each}</div>
        {:else}<p class="empty">Nothing in the Journal for this project yet.</p>{/if}

        <div class="section-head"><h2>Assignments</h2><span class="count">{data.assignments.length}</span></div>
        {#if data.assignments.length}
          <div class="list">
            {#each data.assignments as o (o.key)}
              <RecRow slug={data.slug} rec={{ key: o.key, title: o.title, status: o.status_words, updated_at: o.updated_at }} sub={o.owner ? `for ${o.owner}` : null} />
            {/each}
          </div>
        {:else}<p class="empty">No assignments for this project yet.</p>{/if}
      {/if}

      {#if rec.kind === "knowledge"}
        <div class="section-head"><h2>Skills that depend on this</h2><span class="count">{data.skills.length}</span></div>
        {#if data.skills.length}
          <div class="list">
            {#each data.skills as s (s.key)}
              <a class="row" href="/c/{data.slug}/skills/{s.key}"><span class="row-main"><span class="row-title">{s.title}</span><span class="row-sub">{s.key}</span></span>{#if s.archived}<span class="chip archived">archived</span>{/if}</a>
            {/each}
          </div>
        {:else}<p class="empty">No skill depends on this yet.</p>{/if}
      {/if}

      <details class="card edit">
        <summary>Edit this {words(rec.kind === "entry" ? "entry" : rec.kind)}</summary>
        <form method="POST" action="?/patch" use:enhance>
          <input type="hidden" name="rev" value={rec.rev} />
          <input type="hidden" name="title_field" value={data.titleField} />
          <label class="field"><span>Title</span><input name="title" value={data.title === rec.key ? "" : data.title} /></label>
          {#if data.statuses}
            <label class="field"><span>Status</span>
              <select name="status" value={status}>
                {#if !status}<option value="">(none)</option>{/if}
                {#if status && !data.statuses.includes(status)}<option value={status}>{words(status)}</option>{/if}
                {#each data.statuses as s (s)}<option value={s}>{words(s)}</option>{/each}
              </select>
            </label>
          {:else if status}
            <label class="field"><span>Status</span><input name="status" value={status} /></label>
          {/if}
          {#each data.fields as f (f.name)}
            <label class="field"><span>{label(f.name)}</span>
              {#if isLong(f.value)}<textarea name="f.{f.name}" rows="6" value={f.value}></textarea>{:else}<input name="f.{f.name}" value={f.value} />{/if}
            </label>
          {/each}
          <label class="field"><span>Why (optional, kept in the history)</span><input name="why" maxlength="300" /></label>
          <div class="actions"><button class="btn primary">Save changes</button></div>
        </form>
      </details>
    </div>

    <aside>
      {#each [{ name: "Points at", items: data.links.out }, { name: "Pointed at by", items: data.links.in }] as group (group.name)}
        {#if group.items.length}
          <div class="section-head"><h2>{group.name}</h2><span class="count">{group.items.length}</span></div>
          <div class="list">
            {#each group.items.slice(0, 12) as l (l.label + l.key)}
              <a class="row link" href="/c/{data.slug}/r/{l.key}">
                <TypeIcon type={l.kind} size={24} />
                <span class="row-main">
                  <span class="row-title clamp-2">{l.title}</span>
                  <span class="row-sub">{words(l.label.replace(/_ids?$/, ""))} · {l.key}</span>
                </span>
              </a>
            {/each}
          </div>
          {#if group.items.length > 12}<p class="dim small">and {group.items.length - 12} more</p>{/if}
        {/if}
      {/each}

      <div class="section-head"><h2>History</h2><span class="count">{data.history.length}</span></div>
      <ol class="timeline">
        {#each shown as h, i (h.rev)}
          <li>
            <div class="t-head">
              <Avatar who={h.actor} slug={data.slug} size={18} label />
              <span class="dim">{opWords(h.op)} · {ago(h.at)}</span>
              {#if i === 0 && data.canUndo}
                <form method="POST" action="?/undo" use:enhance class="undo">
                  <input type="hidden" name="rev" value={h.rev} />
                  <button class="btn ghost small">Undo</button>
                </form>
              {/if}
            </div>
            {#if h.why}<p class="why"><Text text={h.why} slug={data.slug} /></p>{/if}
            {#each h.changes.slice(0, 4) as c (c.field)}
              <p class="change"><b>{label(c.field)}</b> {#if c.from}<s>{c.from}</s> → {/if}{c.to || "(removed)"}</p>
            {/each}
            {#if h.changes.length > 4}<p class="change dim">and {h.changes.length - 4} more fields</p>{/if}
          </li>
        {/each}
      </ol>
      {#if data.history.length > 4 && !allHistory}<button class="btn ghost small" type="button" onclick={() => (allHistory = true)}>Show all {data.history.length} changes</button>{/if}

      <div class="archive">
        {#if rec.archived}
          <form method="POST" action="?/restore" use:enhance><button class="btn">Restore</button></form>
        {:else}
          <form method="POST" action="?/archive" use:enhance><button class="btn danger">Archive</button></form>
        {/if}
        <p class="dim">Nothing is ever deleted. Archived records can be restored.</p>
      </div>
    </aside>
  </div>
</div>

<style>
  .rec-head h1 { overflow-wrap: anywhere; margin-top: 4px; }
  .rec-head .eyebrow { gap: 8px; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 12px; font-size: 13.5px; }
  .body { padding: 20px; }
  .edit { margin-top: 16px; padding: 4px 16px; box-shadow: none; }
  .edit > summary { min-height: 48px; display: flex; align-items: center; font-weight: 600; font-size: 14px; color: var(--ink-2); }
  .edit form { display: grid; gap: 4px; padding: 8px 0 12px; }
  .edit textarea { width: 100%; font: inherit; }
  .link { gap: 10px; padding: 9px 14px; min-height: 48px; }
  .link .row-title { font-size: 14px; }
  .small { font-size: 13px; margin: 4px 2px 0; }
  .timeline { list-style: none; margin: 0; padding: 0 0 0 4px; }
  .timeline li { position: relative; padding: 0 0 16px 18px; border-left: 1px solid var(--line); }
  .timeline li::before { content: ""; position: absolute; left: -4px; top: 6px; width: 7px; height: 7px; border-radius: 50%; background: var(--line-2); }
  .timeline li:first-child::before { background: var(--blue); }
  .timeline li:last-child { border-left-color: transparent; }
  .t-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
  .undo { margin-left: auto; }
  .undo .btn { min-height: 32px; }
  .why { margin: 4px 0 0; font-size: 13.5px; font-style: italic; color: var(--ink-2); }
  .change { margin: 3px 0 0; font-size: 13px; color: var(--ink-2); overflow-wrap: anywhere; }
  .change s { color: var(--faint); }
  .archive { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line); }
  .archive .dim { font-size: 12.5px; margin: 8px 0 0; }
</style>
