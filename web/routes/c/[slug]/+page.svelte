<!-- Today: the briefing, what needs the owner, the last day's Journal (outcomes and actions), and open work. Refreshes itself every 10 s. -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import Avatar from "#lib/Avatar.svelte";
  import EntryRow from "#lib/EntryRow.svelte";
  import NeedItem from "#lib/NeedItem.svelte";
  import Text from "#lib/Text.svelte";
  import TypeIcon from "#lib/TypeIcon.svelte";
  import { actor, ago, byDay } from "#lib/fmt.ts";
  let { data, form } = $props();

  const inbox = $derived(data.inbox);
  const waiting = $derived(inbox.requests.length + inbox.needs_you.length + inbox.flags.length);
  const lines = $derived(String(inbox.briefing?.text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean));
  // The day in one sentence: "18 outward actions and 3 outcomes in the last 24 hours, by the agent."
  const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const summary = $derived.by(() => {
    const c = data.counts; const parts: string[] = [];
    if (c.outcome) parts.push(plural(c.outcome, "outcome"));
    const actions = (c.action ?? 0) - data.machine;
    if (actions) parts.push(plural(actions, "outward action"));
    if (c.note) parts.push(plural(c.note, "note"));
    if (!parts.length) return "A quiet day: nothing new in the last 24 hours.";
    const who = [...new Set(data.journal.map((e) => actor(e.by, data.slug).short))];
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return `${list} in the last 24 hours${who.length === 1 ? `, by ${who[0] === "Agent" ? "the agent" : who[0]}` : who.length ? `, by ${who.length} agents and people` : ""}.`;
  });
  const date = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const SHOW = 12;
  let all = $state(false);
  const shown = $derived(all ? data.journal : data.journal.slice(0, SHOW));
  const projects = $derived(new Map<string, string>());
  let sending = $state(false);

  // New requests appear without a reload: refresh while the page is visible, and when it becomes visible again.
  $effect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && !sending) void invalidateAll(); };
    const timer = setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  });

</script>

<svelte:head><title>Today · {data.company.name}</title></svelte:head>
<div class="page wide today">
  <header class="page-head">
    <div class="label-mono">{date} · Company</div>
    <h1>{data.company.name}</h1>
    {#if data.pulse?.agent}
      <p class="agent-line" class:live={data.pulse.agent.working}>
        <span class="dot"></span>
        <span>{data.pulse.agent.working ? "Agent working now" : `Agent last active ${ago(data.pulse.agent.last_seen)}`}{#if data.pulse.focus} · {data.pulse.focus}{/if}</span>
      </p>
    {/if}
    <p class="lede">{summary}</p>
  </header>

  {#if data.pulse}
    {@const p = data.pulse}
    <a class="tele" href="/c/{data.slug}/journal?type=session&since=24h">
      <span>{#if p.day.minutes}{hm(p.day.minutes)} worked{" · "}{/if}{plural(p.day.sessions, "session")}{#if p.day.failed}{" · "}<span class="fail">{p.day.failed} with errors</span>{/if}{#if data.machine}{" · "}{plural(data.machine, "raw command")}{/if}</span>
      <span class="bars" role="img" aria-label="Entries per day, last 7 days">{#each p.week as n, i}<i class:now={i === 6} style="height:{Math.max(7, Math.round(Math.sqrt(n / Math.max(1, ...p.week)) * 100))}%"></i>{/each}</span>
    </a>
  {/if}

  <div class="split">
    <div>
      <section id="needs">
        {#if form?.error}<p class="error" role="alert">{form.error}</p>{:else if form?.done}<p class="notice" role="status">{form.done}</p>{/if}
        {#if waiting}
          <div class="section-head"><h2>Needs you</h2><span class="count">{waiting}</span></div>
          {#each inbox.requests as r (r.key)}<NeedItem kind="request" item={r} slug={data.slug} onbusy={(b) => (sending = b)} />{/each}
          {#each inbox.needs_you as w (w.key)}<NeedItem kind="answer" item={w} slug={data.slug} draft={form?.key === w.key ? String(form?.answer ?? "") : ""} onbusy={(b) => (sending = b)} />{/each}
          {#each inbox.flags as f (f.key)}<NeedItem kind="flag" item={f} slug={data.slug} onbusy={(b) => (sending = b)} />{/each}
        {:else}
          <p class="empty"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Nothing needs you.</p>
        {/if}
      </section>

      <div class="section-head"><h2>{data.journal.length ? "What happened" : "Last activity"}</h2>{#if data.journal.length}<span class="count">{data.journal.length}</span>{/if}<a href="/c/{data.slug}/journal">Journal →</a></div>
      {#if data.journal.length}
        <div class="list">
          {#each byDay(shown, (e) => e.at) as g, i}
            {#if i > 0 || byDay(shown, (e) => e.at).length > 1}<div class="day">{g.day}</div>{/if}
            {#each g.rows as e (e.key)}<EntryRow slug={data.slug} {e} {projects} />{/each}
          {/each}
        </div>
        {#if data.journal.length > SHOW && !all}<button class="btn ghost wide" onclick={() => (all = true)}>Show {data.journal.length - SHOW} more</button>{/if}
      {:else if data.recent.length}
        <div class="list">{#each data.recent as e (e.key)}<EntryRow slug={data.slug} {e} {projects} showDay />{/each}</div>
      {:else}
        <p class="empty">Nothing in the Journal yet. Agents write here as they work.</p>
      {/if}
    </div>

    <aside>
      {#if inbox.briefing}
        <section class="card brief">
          <div class="brief-head"><TypeIcon type="briefing" size={26} /><div><h2>{inbox.briefing.title}</h2><span class="dim">from the Curator · {ago(inbox.briefing.at)}</span></div></div>
          {#each lines as l}<p><Text text={l} slug={data.slug} /></p>{/each}
        </section>
      {:else}
        <a class="card quiet curator-cta" href="/c/{data.slug}/curator">
          <TypeIcon type="briefing" size={26} />
          <span><b>Ask the Curator</b><span class="dim">What moved this week? What is stuck?</span></span>
        </a>
      {/if}

      <div class="section-head" id="work"><h2>Open assignments</h2><span class="count">{data.work.length}</span><a href="/c/{data.slug}/work">All work →</a></div>
      {#if data.work.length}
        <div class="list">
          {#each data.work as w (w.key)}
            <a class="row" href="/c/{data.slug}/assignments/{w.key}">
              <span class="row-main">
                <span class="row-title clamp-2">{w.title}</span>
                <span class="row-sub"><Avatar who={w.owner} slug={data.slug} size={16} label /> · {ago(w.updated_at)}</span>
              </span>
              <span class="chip {w.status}">{w.status_words}</span>
            </a>
          {/each}
        </div>
      {:else}<p class="empty">No assignments open. Hand an outcome to an agent from any record.</p>{/if}
    </aside>
  </div>
</div>

<style>
  .agent-line { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; font: 500 12px var(--mono); color: var(--faint); }
  .agent-line.live { color: var(--teal); }
  .agent-line.live .dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 18%, transparent); }
  .page-head h1 { margin-top: 8px; font-size: 36px; }
  .day { padding: 8px 16px 6px; font-size: 12px; font-weight: 600; color: var(--dim); background: var(--card-2); border-top: 1px solid var(--line); letter-spacing: .02em; }
  .day:first-child { border-top: 0; }
  .tele { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 12px 0; margin: 0 0 8px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); text-decoration: none; font: 12px var(--mono); color: var(--dim); }
  .tele:hover { color: var(--ink-2); }
  .tele .bars { width: 140px; flex: none; height: 26px; }
  .fail { color: var(--red); white-space: nowrap; }
  .item { overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 8px; }
  .item-top { display: flex; align-items: center; gap: 10px; }
  .item-top .when { margin-left: auto; font-size: 12.5px; color: var(--faint); white-space: nowrap; }
  .item-title { display: block; font-weight: 600; font-size: 17px; line-height: 1.35; text-decoration: none; letter-spacing: -.01em; }
  .why { margin: 0; color: var(--ink-2); }
  .meta { margin: 0; font-size: 13px; color: var(--dim); }
  .change { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--card-2); border: 1px solid var(--line); font-weight: 500; }
  .change .dim { font-size: 12px; font-weight: 500; }
  .exact { font-size: 13px; color: var(--dim); }
  .exact summary { min-height: 36px; display: flex; align-items: center; }
  pre { margin: 0; padding: 10px; background: var(--card-2); border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px ui-monospace, Menlo, monospace; color: var(--ink-2); }
  textarea { width: 100%; font: inherit; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
  .big { min-height: 50px; font-size: 16px; }
  .brief { border-color: color-mix(in srgb, var(--violet) 30%, var(--line)); }
  .brief-head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
  .brief-head h2 { font-size: 15px; } .brief-head .dim { font-size: 12.5px; }
  .brief p { margin: 0 0 6px; font-size: 14.5px; color: var(--ink-2); }
  .curator-cta { display: flex; gap: 12px; align-items: center; text-decoration: none; margin-top: 4px; }
  .curator-cta b { display: block; font-weight: 600; } .curator-cta .dim { font-size: 13px; }
  aside .section-head:first-of-type { margin-top: 24px; }
  @media (min-width: 1101px) { aside > :first-child { margin-top: 38px; } }
</style>
