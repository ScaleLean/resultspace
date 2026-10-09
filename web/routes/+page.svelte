<!-- Home: every company at once (docs/design/UI.md). The headline is the answer ("2 things need you" or "You're
     caught up"); then what waits, acted on in place; what each busy company's agent got done, with its machine
     work folded into one line; and every agent's state. Refreshes itself every 15 s while visible. -->
<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import NeedItem from "#lib/NeedItem.svelte";
  import Shell from "#lib/Shell.svelte";
  import TypeIcon from "#lib/TypeIcon.svelte";
  import { ago, clock, dayLabel, split } from "#lib/fmt.ts";
  import type { Pulse } from "#lib/server/pulse.ts";
  let { data, form } = $props();

  const total = $derived(data.pulses.reduce((n, p) => n + p.needs, 0));
  const busy = $derived(data.pulses.filter((p) => p.day.entries > 0).sort((a, b) => b.day.entries - a.day.entries));
  const working = $derived(data.pulses.filter((p) => p.agent?.working));
  const date = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const lede = $derived.by(() => {
    const parts: string[] = [];
    if (working.length === 1) parts.push(`The ${working[0]!.name} agent is working now.`);
    else if (working.length > 1) parts.push(`${working.length} agents are working now.`);
    parts.push(busy.length ? `${busy.length} of ${plural(data.pulses.length, "company", "companies")} active in the last 24 hours.` : "No agent has written anything in the last 24 hours.");
    return parts.join(" ");
  });
  const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`);
  const TYPE: Record<string, string> = { outcome: "Outcome", action: "Outward", note: "Note" };
  // Agent text as a short headline: drop a trailing "(2026-10-07)", keep the context ("Ads 1234567890") for the meta line.
  const line = (title: string) => {
    const t = title.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");
    return t.length <= 72 ? { context: "", head: t, rest: "" } : split(t, 96);
  };
  const when = (iso: string) => (dayLabel(iso) === "Today" ? clock(iso) : `${dayLabel(iso)} ${clock(iso)}`);
  const state = (p: Pulse) => p.agent?.working ? `Working now · ${hm(p.day.minutes)} today`
    : p.last_at ? (Date.now() - Date.parse(p.last_at) > 2 * 86_400_000 ? `Quiet since ${dayLabel(p.last_at)}` : `Last active ${ago(p.last_at)}`) : "No activity yet";
  const peak = (w: number[]) => Math.max(1, ...w);

  let sending = false;
  $effect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && !sending) void invalidateAll(); };
    const timer = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  });
</script>

{#snippet bars(w: number[], label: string)}
  <span class="bars" role="img" aria-label={label}>{#each w as n, i}<i class:now={i === w.length - 1} style="height:{Math.max(7, Math.round(Math.sqrt(n / peak(w)) * 100))}%"></i>{/each}</span>
{/snippet}

<svelte:head><title>{total ? `(${total}) ` : ""}Home · ResultSpace</title></svelte:head>
<Shell companies={data.rail}>
  <div class="page home">
    <header class="hero">
      <div class="label-mono">{date} · {plural(data.pulses.length, "company", "companies")}</div>
      <h1>{#if total}<span class="n">{total}</span> {total === 1 ? "thing needs" : "things need"} you{:else}You're caught up.{/if}</h1>
      <p class="lede">{lede}</p>
    </header>

    <div class="cols">
      <section class="needs" aria-labelledby="h-needs">
        <div class="section-head"><h2 id="h-needs">Needs you</h2>{#if total}<span class="count amber">{total}</span>{/if}</div>
        {#if form?.error}<p class="error" role="alert">{form.error}</p>{:else if form?.done}<p class="notice" role="status">{form.done}</p>{/if}
        {#each data.waiting as w (w.slug)}
          {#each w.inbox.requests as r (r.key)}<NeedItem kind="request" item={r} slug={w.slug} company={w.name} onbusy={(b) => (sending = b)} />{/each}
          {#each w.inbox.needs_you as r (r.key)}<NeedItem kind="answer" item={r} slug={w.slug} company={w.name} draft={form?.key === r.key ? String(form?.answer ?? "") : ""} onbusy={(b) => (sending = b)} />{/each}
          {#each w.inbox.flags as r (r.key)}<NeedItem kind="flag" item={r} slug={w.slug} company={w.name} onbusy={(b) => (sending = b)} />{/each}
        {:else}
          <div class="calm">
            <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            <div><b>Nothing needs you.</b><span>Approvals, questions from agents and flags land here.</span></div>
          </div>
        {/each}
      </section>

      <section class="moved" aria-labelledby="h-moved">
        <div class="section-head"><h2 id="h-moved">What got done</h2><span class="count">last 24 h</span></div>
        {#each busy as p (p.slug)}
          <article class="co">
            <a class="co-head" href="/c/{p.slug}">
              <span class="co-name">{p.name}</span>
              {#if p.agent?.working}<span class="state live"><span class="dot"></span>Working</span>{:else}<span class="state">{ago(p.last_at)}</span>{/if}
            </a>
            {#if p.focus}<p class="focus">Focus: {p.focus}</p>{/if}
            {#if p.highlights.length}
              <ul class="digest">
                {#each p.highlights as h (h.key)}
                  {@const s = line(h.title)}
                  <li>
                    <TypeIcon type={h.type} size={18} bare />
                    <a href="/c/{p.slug}/r/{h.key}">
                      <span class="head">{s.head}</span>
                      <span class="meta">{s.context || TYPE[h.type] || h.type} · {when(h.at)}</span>
                    </a>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="focus">Only machine work today: nothing worth reading yet.</p>
            {/if}
            <a class="tele" href="/c/{p.slug}/journal?type=session&since=24h">
              <span>{#if p.day.minutes}{hm(p.day.minutes)} worked{" · "}{/if}{plural(p.day.sessions, "session")}{#if p.day.failed}{" · "}<span class="fail">{p.day.failed} with errors</span>{/if}</span>
              {@render bars(p.week, "Entries per day, last 7 days")}
            </a>
          </article>
        {:else}
          <p class="empty">No agent wrote anything in the last 24 hours.</p>
        {/each}
      </section>

      <section class="agents" aria-labelledby="h-agents">
        <div class="section-head"><h2 id="h-agents">Agents</h2><span class="count">{working.length} working</span></div>
        <div class="agent-list">
          {#each data.pulses as p (p.slug)}
            <a class="agent" href="/c/{p.slug}">
              <span class="dot {p.agent?.working ? 'live' : 'quiet'}"></span>
              <span class="who"><b>{p.name}</b><span class:live={p.agent?.working}>{state(p)}</span></span>
              {#if p.needs}<span class="badge">{p.needs}</span>{/if}
              {@render bars(p.week, "Entries per day, last 7 days")}
            </a>
          {/each}
        </div>
      </section>
    </div>
  </div>
</Shell>

<style>
  .home { max-width: 1480px; }
  .hero { margin: 4px 0 8px; }
  .hero h1 { font-size: 40px; letter-spacing: -.05em; margin-top: 10px; font-weight: 640; }
  .hero .n { color: var(--amber); }
  .hero .lede { color: var(--dim); margin: 8px 0 0; font-size: 15px; }
  .count.amber { color: var(--amber); }

  .cols { display: grid; gap: 8px 40px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1100px) { .cols { grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); } .agents { grid-column: 1 / -1; } }
  @media (min-width: 1400px) { .cols { grid-template-columns: minmax(300px, 380px) minmax(0, 1fr) 300px; } .agents { grid-column: auto; } }

  .calm { display: flex; gap: 12px; align-items: flex-start; padding: 16px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .calm svg { color: var(--teal); width: 22px; height: 22px; }
  .calm b { display: block; font-weight: 620; font-size: 15px; }
  .calm span { color: var(--dim); font-size: 13.5px; }

  .co { border-top: 1px solid var(--line); padding: 16px 0 14px; }
  .co-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; text-decoration: none; }
  .co-name { font-size: 18px; font-weight: 640; letter-spacing: -.03em; }
  .co-head:hover .co-name { text-decoration: underline; text-decoration-color: var(--line-2); }
  .state { display: inline-flex; align-items: center; gap: 7px; font: 500 11px var(--mono); letter-spacing: .05em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
  .state.live { color: var(--teal); }
  .focus { color: var(--dim); font-size: 13.5px; margin: 2px 0 0; }
  .digest { list-style: none; margin: 10px 0 0; padding: 0; }
  .digest li { display: flex; gap: 10px; align-items: flex-start; }
  .digest li :global(.ti) { margin-top: 9px; }
  .digest a { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 7px 0; text-decoration: none; }
  .digest .head { font-weight: 540; font-size: 14.5px; line-height: 1.4; overflow-wrap: anywhere; }
  .digest a:hover .head { text-decoration: underline; text-decoration-color: var(--line-2); }
  .digest .meta { font: 11px var(--mono); color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tele { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); text-decoration: none; font: 11.5px var(--mono); color: var(--dim); }
  .tele:hover { color: var(--ink-2); }
  .tele .bars { width: 120px; flex: none; height: 24px; }
  .fail { color: var(--red); white-space: nowrap; }

  .agent-list { border-top: 1px solid var(--line); }
  .agent { display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 8px 4px; border-bottom: 1px solid var(--line); text-decoration: none; }
  .agent:hover { background: var(--hover); }
  .agent .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .agent .who b { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agent .who span { font: 11px var(--mono); color: var(--faint); }
  .agent .who span.live { color: var(--teal); }
  .agent .badge { margin: 0; }
  .agent .bars { width: 56px; height: 18px; flex: none; }
  .dot.live { box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 18%, transparent); }
  @media (max-width: 820px) { .hero h1 { font-size: 32px; } }
</style>
