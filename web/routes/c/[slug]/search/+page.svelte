<!-- Search every record of the company. -->
<script lang="ts">
  import TypeIcon from "#lib/TypeIcon.svelte";
  import { split, words } from "#lib/fmt.ts";
  import Snippet from "./Snippet.svelte";
  let { data } = $props();
  const kinds = $derived([...new Set(data.hits.map((h) => h.kind))]);
  let only = $state("");
  const hits = $derived(only ? data.hits.filter((h) => h.kind === only) : data.hits);
</script>

<svelte:head><title>Search · {data.company.name}</title></svelte:head>

<div class="page">
  <header class="page-head"><h1>Search</h1></header>
  <form method="GET" class="find" role="search">
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4" /></svg>
    <!-- svelte-ignore a11y_autofocus -->
    <input name="q" type="search" value={data.q} placeholder="Search everything" aria-label="Search" maxlength="400" autofocus={!data.q} />
  </form>

  {#if data.q}
    {#if kinds.length > 1}
      <nav class="filters" aria-label="Kind">
        <button type="button" class="chip" class:on={!only} onclick={() => (only = "")}>All <span class="n">{data.hits.length}</span></button>
        {#each kinds as k}<button type="button" class="chip" class:on={only === k} onclick={() => (only = k)}>{k === "entry" ? "journal" : words(k)} <span class="n">{data.hits.filter((h) => h.kind === k).length}</span></button>{/each}
      </nav>
    {/if}
    {#if hits.length}
      <div class="list">
        {#each hits as h (h.id)}
          {@const s = split(h.title || h.key, 90)}
          <a class="row hit" href="/c/{data.slug}/r/{h.key}">
            <TypeIcon type={h.kind} size={28} />
            <span class="row-main">
              {#if s.context}<span class="ctx">{s.context}</span>{/if}
              <span class="row-title clamp-2">{s.head}</span>
              <Snippet text={h.snippet} />
            </span>
          </a>
        {/each}
      </div>
    {:else}
      <p class="empty">Nothing found for “{data.q}”. Try fewer or shorter words.</p>
    {/if}
  {:else}
    <p class="muted">Search goals, projects, tasks, the Journal, knowledge and skills. Words match the start of longer words.</p>
  {/if}
</div>

<style>
  .find { display: flex; align-items: center; margin: 0 0 16px; position: relative; }
  .find .ic { position: absolute; left: 13px; color: var(--faint); pointer-events: none; }
  .find input { flex: 1; min-width: 0; padding-left: 42px; }
  .filters button { font: inherit; cursor: pointer; }
  .hit { align-items: flex-start; }
  .ctx { font-size: 12px; color: var(--dim); }
  .hit :global(.snip) { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
</style>
