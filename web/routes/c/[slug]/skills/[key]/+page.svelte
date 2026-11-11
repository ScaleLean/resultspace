<!-- One skill: the SKILL.md rendered (escaped first, see web/lib/md.ts), the knowledge it depends on, what uses it. -->
<script lang="ts">
  import { ago, words } from "#lib/fmt.ts";
  let { data } = $props();
</script>

<svelte:head><title>{data.title} · {data.key}</title></svelte:head>

<div class="page">
  <p class="muted top"><span class="mono">{data.key}</span> · skill{#if data.shared} · shared from {data.company}{/if}</p>
  <h1>{data.title}</h1>
  <p class="meta">
    {#if data.status}<span class="chip {data.status}">{words(data.status)}</span>{/if}
    {#if data.shared}<span class="chip">shared · read-only here</span>{/if}
    {#if data.updated_at}<span class="muted">Changed {ago(data.updated_at)} · revision {data.rev}</span>{/if}
  </p>
  {#if data.when}<p class="when"><b>Use when:</b> {data.when}</p>{/if}

  <div class="card doc">{@html data.html}</div>

  <div class="section-head"><h2>Knowledge it depends on</h2><span class="count">{data.knowledge.length}</span></div>
  {#if data.knowledge.length}
    <div class="list">
      {#each data.knowledge as k (k.key)}
        <a class="row" href="/c/{data.slug}/r/{k.key}"><span class="row-main"><span class="row-title">{k.title}</span><span class="row-sub">{k.key}</span></span></a>
      {/each}
    </div>
  {:else}<p class="empty">This skill cites no knowledge.</p>{/if}

  <div class="section-head"><h2>Used by</h2></div>
  <p class="empty">Nothing yet.</p>

  {#if !data.shared}
    <p class="muted"><a href="/c/{data.slug}/r/{data.key}">Open the record</a> to edit it or see its history.</p>
  {/if}
</div>

<style>
  .top { margin: 0 0 2px; }
  h1 { overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 6px 0 12px; font-size: 0.9rem; }
  .when { margin: 0 0 14px; }
  .doc { overflow-wrap: anywhere; }
  .doc :global(h1) { font-size: 20px; margin: 0 0 10px; }
  .doc :global(h2) { font-size: 16px; margin: 16px 0 8px; }
  .doc :global(h3), .doc :global(h4) { font-size: 14px; margin: 12px 0 6px; }
  .doc :global(p), .doc :global(ul), .doc :global(ol) { margin: 0 0 10px; }
  .doc :global(ul), .doc :global(ol) { padding-left: 22px; }
  .doc :global(pre) { margin: 0 0 10px; padding: 10px; background: var(--side); border-radius: 8px; white-space: pre-wrap; font: 12.5px ui-monospace, Menlo, monospace; }
</style>
