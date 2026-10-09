<!-- Chat with the Curator. The composer is a plain form (say / stop / new actions), so it works without JavaScript;
     with it, the page stays put, polls /api/c/<slug>/chat every 2 s while visible, and keeps the newest message in view. -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import Text from "#lib/Text.svelte";
  import type { ChatState } from "../../../../../src/curator/curator.ts";

  let { data, form } = $props();

  // The newest state: from the poll if there is one since the last load, else from the load.
  let polled = $state<ChatState | null>(null);
  let seq = 0; // goes up with every load, so a poll that started before it is dropped
  $effect(() => { data.chat; seq++; polled = null; });
  const chat = $derived(polled ?? data.chat);

  let draft = $state("");
  let sending = $state(false);
  let err = $state("");
  $effect(() => { err = form?.error ?? ""; });

  // What was just sent, shown until the Curator's own list has it (a message sent while it works waits its turn).
  let pending = $state<{ text: string; after: number } | null>(null);
  const yours = $derived(chat.messages.filter((m) => m.who === "you").length);
  const waiting = $derived(pending && yours <= pending.after ? pending.text : "");
  const working = $derived(chat.busy || sending);

  let formEl = $state<HTMLFormElement>();
  let box = $state<HTMLTextAreaElement>();
  let barH = $state(84);
  let stick = true; // stay at the bottom unless the reader scrolled up

  const bottom = () => window.scrollTo(0, document.documentElement.scrollHeight);
  $effect(() => {
    chat.messages.length; chat.partial; chat.tools.length; waiting; barH;
    if (stick) bottom();
  });
  $effect(() => {
    const onScroll = () => { stick = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 90; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  });

  // Poll while the page is visible.
  $effect(() => {
    const url = `/api/c/${data.slug}/chat`;
    let flying = false;
    const poll = async () => {
      if (document.hidden || flying || sending) return;
      flying = true;
      const at = seq;
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (res.ok && !res.redirected && at === seq && !sending) polled = (await res.json()) as ChatState;
      } catch { /* offline: try again next time */ }
      flying = false;
    };
    const t = setInterval(poll, 2000);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", poll); };
  });

  function grow() {
    if (!box) return;
    box.style.height = "auto";
    box.style.height = Math.min(box.scrollHeight + 2, 160) + "px";
  }
  function keydown(e: KeyboardEvent) {
    // Enter sends, Shift+Enter is a new line. On a touch keyboard Enter is a new line: the Send button is right there.
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    formEl?.requestSubmit();
  }
</script>

<svelte:head><title>Curator · {data.company.name}</title></svelte:head>

<div class="page chat" style:padding-bottom="{barH + 16}px">
  <div class="section-head head">
    <div class="who"><span class="spark" aria-hidden="true">✦</span><div><h1>Curator</h1><span class="dim sub">Keeps {data.company.name}'s record true. It reads; it never does company work.</span></div></div>
    {#if data.available && chat.messages.length}
      <form method="POST" action="?/new" use:enhance={({ cancel }) => {
        if (!confirm("Start a new chat? This one is put away.")) return cancel();
        pending = null; stick = true;
      }}>
        <button class="btn small">New chat</button>
      </form>
    {/if}
  </div>

  {#if !data.available}
    <p class="error">The Curator is off: this server has no model key.</p>
  {/if}

  <div class="msgs" aria-live="polite">
    {#each chat.messages as m}
      {#if m.who === "tool"}
        <div class="tool">↳ {m.text.split(" ")[0]?.replace(/_/g, " ")}</div>
      {:else if m.who === "you"}
        <div class="msg you"><span class="plain">{m.text}</span></div>
      {:else}
        <div class="msg cur"><span class="spark small" aria-hidden="true">✦</span><div><Text text={m.text} slug={data.slug} /></div></div>
      {/if}
    {:else}
      {#if data.available && !waiting}
        <div class="intro">
          <p>Ask about anything on record. It answers from the records and cites them, and it can hand work to an agent.</p>
          <div class="sugg">
            {#each ["What moved this week?", "What is stuck, and why?", "Summarise today's outward actions", "Which knowledge looks out of date?", "What should I decide next?"] as q}
              <button type="button" class="chip" onclick={() => { draft = q; queueMicrotask(() => { grow(); box?.focus(); }); }}>{q}</button>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
    {#if waiting}<div class="msg you wait"><span class="plain">{waiting}</span></div>{/if}
    {#if chat.partial}<div class="msg cur"><Text text={chat.partial} slug={data.slug} /></div>{/if}
    {#if working}
      <div class="status muted">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        {chat.tools.length ? `Using ${chat.tools.join(", ")}` : chat.partial ? "Writing" : "Thinking"}
      </div>
    {/if}
  </div>
</div>

<form class="bar" method="POST" action="?/say" bind:this={formEl} bind:clientHeight={barH}
  use:enhance={({ formData, submitter, cancel }) => {
    const stop = (submitter as HTMLButtonElement | null)?.formAction.includes("/stop");
    const text = String(formData.get("text") ?? "").trim();
    if (!stop) {
      if (!text || sending) return cancel();
      pending = { text, after: yours };
      draft = ""; sending = true; stick = true;
      queueMicrotask(grow);
    }
    err = "";
    return async ({ result, update }) => {
      await update({ reset: false });
      if (!stop) {
        sending = false;
        if (result.type !== "success") { pending = null; draft = text; queueMicrotask(grow); }
      }
    };
  }}>
  <div class="in">
    {#if err}<p class="error">{err}</p>{/if}
    <div class="line">
      <textarea name="text" rows="1" bind:this={box} bind:value={draft} oninput={grow} onkeydown={keydown}
        disabled={!data.available} aria-label="Message to the Curator"
        placeholder={data.available ? (chat.busy ? "Add a message…" : "Ask the Curator…") : "The Curator is off"}></textarea>
      <button class="btn primary" disabled={!data.available || sending}>Send</button>
    </div>
    {#if chat.busy}
      <div class="line">
        <button class="btn small danger" formaction="?/stop" formnovalidate>Stop</button>
        <button class="btn small" name="steer" value="1" disabled={sending} title="Interrupt the Curator with this message instead of waiting for it to finish">Send now</button>
        <span class="muted hint">Send waits for it to finish.</span>
      </div>
    {/if}
  </div>
</form>

<style>
  .chat { display: flex; flex-direction: column; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 18px; }
  .head h1 { margin: 0; font-size: 24px; }
  .who { display: flex; gap: 12px; align-items: center; min-width: 0; }
  .sub { font-size: 13px; display: block; }
  .spark { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: var(--violet); background: var(--violet-bg); font-size: 18px; flex: none; }
  .spark.small { width: 24px; height: 24px; border-radius: 8px; font-size: 12px; }
  .intro { padding: 4px 0; color: var(--ink-2); }
  .sugg { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .sugg .chip { all: unset; cursor: pointer; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line-2); font-size: 14px; color: var(--ink); background: var(--card); min-height: 24px; }
  .sugg .chip:hover { background: var(--hover); }
  .msgs { display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: min(88%, 640px); padding: 9px 13px; border-radius: 16px; border: 1px solid var(--line); background: var(--card); }
  .msg.you { align-self: flex-end; background: var(--ink); color: var(--bg); border-color: var(--ink); border-bottom-right-radius: 5px; }
  .msg.cur { align-self: flex-start; display: flex; gap: 10px; align-items: flex-start; border: 0; background: transparent; padding: 4px 0; max-width: min(100%, 680px); line-height: 1.6; }
  .msg.wait { opacity: 0.6; }
  .plain { white-space: pre-wrap; overflow-wrap: anywhere; }
  .tool { color: var(--faint); font-size: 12px; padding: 0 0 0 34px; }
  .status { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 2px 4px; overflow-wrap: anywhere; }
  .dots { display: inline-flex; gap: 3px; flex: none; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: blink 1.2s infinite both; }
  .dots i:nth-child(2) { animation-delay: 0.2s; }
  .dots i:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .dots i { animation: none; } }

  /* The composer: fixed at the bottom of the window; on a phone it sits on top of the tab bar. --railw = the rail (app.css). */
  .bar { position: fixed; left: var(--railw); right: 0; bottom: 0; z-index: 4; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid var(--line);
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
  .in { max-width: 760px; margin: 0 0 0 16px; display: flex; flex-direction: column; gap: 8px; }
  .in .error { margin: 0; }
  .line { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
  .line textarea { flex: 1; min-width: 0; min-height: 44px; max-height: 160px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--card); color: var(--ink); font: inherit; font-size: 16px; line-height: 1.4; resize: none; display: block; }
  .line textarea:disabled { opacity: 0.6; }
  .hint { font-size: 12.5px; align-self: center; }
  @media (max-width: 820px) {
    .in { margin: 0 auto; }
    .bar { left: 0; bottom: calc(var(--tabh) + env(safe-area-inset-bottom)); padding: 8px 12px; }
    .msg { max-width: 92%; }
  }
</style>
