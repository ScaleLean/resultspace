<!-- Activity: every change to every record, newest first, grouped by day. Agent sessions are folded away unless asked for. -->
<script lang="ts">
  import Avatar from "#lib/Avatar.svelte";
  import TypeIcon from "#lib/TypeIcon.svelte";
  import { byDay, clock, split, words } from "#lib/fmt.ts";
  import type { Change } from "./+page.server.ts";
  let { data } = $props();
  const label: Record<string, string> = { "24h": "24 hours", "7d": "7 days" };
  let sessions = $state(false);
  // A Journal entry for a tool-call session is noise here unless looked for.
  const isSession = (c: Change) => c.kind === "entry" && /\(session end\)/.test(c.title);
  const shown = $derived(sessions ? data.changes : data.changes.filter((c) => !isSession(c)));
  const hidden = $derived(data.changes.length - data.changes.filter((c) => !isSession(c)).length);
  function what(c: Change): string {
    const op = c.op.split(".").pop() ?? c.op;
    if (/creat|add|log|import/.test(op) && c.changed.length !== 1) return "added";
    if (/archiv/.test(op)) return "archived";
    if (/restor/.test(op)) return "restored";
    const f = c.changed.filter((x) => x !== "updated_at").slice(0, 2).map(words).join(" and ");
    return f ? `changed ${f}${c.changed.length > 2 ? " and more" : ""}` : words(op);
  }
</script>

<svelte:head><title>Activity · {data.company.name}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <h1>Activity</h1>
    <p class="lede">Every change to every record, as the audit trail keeps it.</p>
  </header>
  <div class="bar">
    <nav class="seg" aria-label="Period">
      {#each Object.keys(label) as s}<a class:on={data.since === s} href="?since={s}" aria-current={data.since === s ? "true" : undefined}>{label[s]}</a>{/each}
    </nav>
    {#if hidden}<label class="tog"><input type="checkbox" bind:checked={sessions} /> Show {hidden} agent sessions</label>{/if}
  </div>
  {#if shown.length}
    {#each byDay(shown, (c) => c.at) as g}
      <div class="section-head"><h2>{g.day}</h2><span class="count">{g.rows.length}</span></div>
      <div class="list">
        {#each g.rows as c (c.seq)}
          {@const s = split(c.title, 100)}
          <a class="row act" href="/c/{data.slug}/r/{c.key}">
            <TypeIcon type={c.kind} size={26} />
            <span class="row-main">
              <span class="line"><Avatar who={c.actor} slug={data.slug} size={16} label /> <span class="dim">{what(c)}</span></span>
              <span class="row-title clamp-2">{s.head}</span>
              {#if c.why}<span class="row-sub">{c.why}</span>{/if}
            </span>
            <time class="at" datetime={c.at}>{clock(c.at)}</time>
          </a>
        {/each}
      </div>
    {/each}
    {#if data.full}<p class="muted">Showing the newest {data.changes.length} changes.</p>{/if}
  {:else}
    <p class="empty">Nothing changed in this period.</p>
  {/if}
</div>

<style>
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 4px; }
  .seg { display: inline-flex; background: var(--hover); border-radius: 10px; padding: 3px; gap: 2px; }
  .seg a { min-height: 38px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 8px; text-decoration: none; font-size: 13.5px; font-weight: 500; color: var(--ink-2); }
  .seg a.on { background: var(--card); color: var(--ink); box-shadow: var(--shadow); font-weight: 600; }
  .tog { display: inline-flex; gap: 8px; align-items: center; font-size: 13.5px; color: var(--dim); min-height: 44px; cursor: pointer; }
  .act { align-items: flex-start; }
  .line { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  .row-title { font-size: 14.5px; }
  .at { font-size: 12px; color: var(--faint); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; padding-top: 2px; }
</style>
