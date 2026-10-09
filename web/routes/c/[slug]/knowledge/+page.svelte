<!-- Knowledge: what the company knows. Collections as cards, the latest changes, one collection (?c=), or search (?q=). -->
<script lang="ts">
  import { ago, words } from "#lib/fmt.ts";
  import Snippet from "../search/Snippet.svelte";
  let { data } = $props();
  const name = (n: string) => { const w = n ? words(n) : "Other"; return w.charAt(0).toUpperCase() + w.slice(1); };
  const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
</script>

<svelte:head><title>Knowledge · {data.company.name}</title></svelte:head>

<div class="page wide">
  <header class="page-head">
    {#if data.open}<div class="eyebrow"><a href="?">Knowledge</a> /</div>{/if}
    <h1>{data.open ? name(data.open.name) : "Knowledge"}</h1>
    <p class="lede">{#if data.open}{data.open.items.length} pages{:else if data.q}Search{:else}What the company knows: {data.total} pages in {data.summary.length} collections.{/if}</p>
  </header>

  <form method="GET" class="find" role="search">
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4" /></svg>
    <input name="q" type="search" value={data.q} placeholder="Search knowledge" aria-label="Search knowledge" maxlength="400" />
  </form>

  {#if data.q}
    <div class="section-head"><h2>Found</h2><span class="count">{data.hits.length}</span><a href="?">Clear</a></div>
    {#if data.hits.length}
      <div class="list">
        {#each data.hits as h (h.id)}
          <a class="row" href="/c/{data.slug}/r/{h.key}"><span class="row-main"><span class="row-title">{h.title || h.key}</span><Snippet text={h.snippet} /></span></a>
        {/each}
      </div>
    {:else}
      <p class="empty">Nothing found for “{data.q}”. <a href="/c/{data.slug}/search?q={encodeURIComponent(data.q)}">Search everything</a></p>
    {/if}
  {:else if data.open}
    <div class="list">
      {#each data.open.items as p (p.key)}
        <a class="row" href="/c/{data.slug}/r/{p.key}"><span class="row-main"><span class="row-title">{p.title}</span><span class="row-sub">changed {ago(p.updated_at)}</span></span></a>
      {/each}
    </div>
  {:else if data.total}
    <div class="grid">
      {#each data.summary as g (g.name)}
        <a class="coll" href="?c={encodeURIComponent(g.name)}" style="--h:{hue(g.name)}">
          <span class="c-top"><span class="c-name">{name(g.name)}</span><span class="c-n tnum">{g.count}</span></span>
          <span class="c-sample">{#each g.sample as t}<span class="clamp-2">{t}</span>{/each}</span>
          <span class="c-when">updated {ago(g.latest)}</span>
        </a>
      {/each}
    </div>

    <div class="section-head"><h2>Recently changed</h2></div>
    <div class="list">
      {#each data.recent as p (p.key)}
        <a class="row" href="/c/{data.slug}/r/{p.key}">
          <span class="row-main"><span class="row-title">{p.title}</span><span class="row-sub">{name(p.collection)} · changed {ago(p.updated_at)}</span></span>
        </a>
      {/each}
    </div>
    <!-- Every page, by collection, for anyone scanning the whole base (and for links that point into it). -->
    <details class="all">
      <summary>Every page, by collection</summary>
      {#each data.groups as g, i}
        <div class="section-head" id="g{i}"><h2>{name(g.name)}</h2><span class="count">{g.items.length}</span></div>
        <div class="list">{#each g.items as p (p.key)}<a class="row" href="/c/{data.slug}/r/{p.key}"><span class="row-main"><span class="row-title">{p.title}</span></span></a>{/each}</div>
      {/each}
    </details>
  {:else}
    <p class="empty">No knowledge pages yet. Agents add them as they learn about the company.</p>
  {/if}
</div>

<style>
  .find { display: flex; align-items: center; gap: 8px; margin: 0 0 22px; position: relative; }
  .find .ic { position: absolute; left: 13px; color: var(--faint); pointer-events: none; }
  .find input { flex: 1; min-width: 0; padding-left: 42px; }
  .eyebrow a { color: var(--dim); text-decoration: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
  .coll { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); text-decoration: none; box-shadow: var(--shadow); min-height: 150px; position: relative; overflow: hidden; }
  .coll::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: hsl(var(--h) 55% 55%); opacity: .8; }
  .coll:hover { border-color: var(--line-2); }
  .c-top { display: flex; align-items: baseline; gap: 8px; }
  .c-name { font-weight: 650; font-size: 16px; letter-spacing: -.01em; flex: 1; }
  .c-n { font-size: 20px; font-weight: 650; color: var(--ink-2); }
  .c-sample { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--dim); line-height: 1.35; flex: 1; }
  .c-when { font-size: 12px; color: var(--faint); }
  .all { margin-top: 20px; }
  .all > summary { min-height: 44px; display: inline-flex; align-items: center; font-weight: 550; color: var(--dim); font-size: 14px; }
  .section-head { scroll-margin-top: 70px; }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr 1fr; gap: 10px; } .coll { min-height: 130px; padding: 14px; } .c-sample span:nth-child(3) { display: none; } }
</style>
