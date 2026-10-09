<!-- One assignment: the outcome asked for, where it stands, what the agent reported, and whether a person verified it.
     Sessions (what the agent's runs did) and outward actions are listed apart from the reported outcome. -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import Avatar from "#lib/Avatar.svelte";
  import RecRow from "#lib/RecRow.svelte";
  import Text from "#lib/Text.svelte";
  import { ago, when } from "#lib/fmt.ts";
  let { data, form } = $props();
  const FINAL = ["done", "failed", "cancelled"]; // same as ASSIGNMENT_FINAL in src/core/schema.ts
  const VERIFICATION: Record<string, string> = { not_verified: "Not verified", verified: "Verified", disputed: "Disputed" };
  let confirming = $state(false);
  const o = $derived(data.assignment);
  const v = $derived(o.verification);
  const txt = (val: unknown) => (typeof val === "string" ? val.trim() : val == null ? "" : JSON.stringify(val, null, 2));
  // "Reported by hermes:acme Oct 8, 06:33. Nobody has verified it yet." / "... Verified by alex Oct 8, 07:10."
  const reportLine = $derived([
    ["Reported", o.reported_by && `by ${o.reported_by}`, o.reported_at && when(o.reported_at)].filter(Boolean).join(" ") + ".",
    v.state === "not_verified" ? "A report is the agent's word: nobody has verified it yet."
      : [VERIFICATION[v.state], v.by && `by ${v.by}`, v.at && when(v.at)].filter(Boolean).join(" ") + ".",
  ].join(" "));
  const groups = $derived([
    { name: "Reported outcomes", empty: "No outcome reported yet.", items: o.outcomes },
    { name: "Outward actions", empty: "", items: o.actions },
    { name: "Agent sessions", empty: "", items: o.sessions },
  ].filter((g) => g.items.length || g.empty));
</script>

<svelte:head><title>{o.title} · {data.company.name}</title></svelte:head>
<div class="page">
  <p class="back"><a href="/c/{data.slug}">Today</a> / <a href="/c/{data.slug}/work">Work</a> / Assignment</p>
  <h1>{o.title}</h1>
  <p class="state">
    <span class="chip {o.status}">{o.status_words}</span>
    {#if o.status === "done"}<span class="chip {v.state === 'verified' ? 'done' : v.state === 'disputed' ? 'failed' : ''}">{VERIFICATION[v.state]}</span>{/if}
    <span class="muted">updated {ago(o.updated_at)}</span>
  </p>

  {#if form?.error}<p class="error" role="alert">{form.error}</p>{:else if form?.done}<p class="notice" role="status">{form.done}</p>{/if}

  {#if o.status === "needs_permission"}
    <form method="POST" action="?/answer" class="card" use:enhance>
      <label class="field"><span>This assignment is waiting for your answer</span><textarea name="answer" rows="3" maxlength="1000" required placeholder="Yes, go ahead / No, because...">{form?.answer ?? ""}</textarea></label>
      <button class="btn primary wide tall">Answer</button>
    </form>
  {/if}

  <dl class="kv card">
    <dt>Owner</dt><dd>{#if o.owner}<Avatar who={o.owner} slug={data.slug} size={18} label />{:else}Nobody yet{/if}</dd>
    {#if o.project}<dt>Project</dt><dd><a href="/c/{data.slug}/r/{o.project}">{o.project}</a></dd>{/if}
    {#if txt(o.due_on)}<dt>Due</dt><dd>{txt(o.due_on)}</dd>{/if}
    <dt>Record</dt><dd><a class="mono" href="/c/{data.slug}/r/{o.key}">{o.key}</a></dd>
  </dl>

  {#if txt(o.result)}
    <div class="section-head"><h2>Reported result</h2></div>
    <div class="card">
      <Text text={txt(o.result)} slug={data.slug} />
      <p class="muted small">{reportLine}</p>
      {#if v.note}<Text text={v.note} slug={data.slug} />{/if}
    </div>
    {#if o.status === "done" && v.state === "not_verified"}
      <form method="POST" action="?/verify" class="card" use:enhance>
        <label class="field"><span>Did you check this result?</span><input name="note" maxlength="1000" placeholder="What you checked, or what does not hold up" value={form?.note ?? ""} /></label>
        <div class="two">
          <button class="btn tall" name="verdict" value="verified">Verified</button>
          <button class="btn tall" name="verdict" value="disputed">Disputed</button>
        </div>
      </form>
    {/if}
  {/if}
  {#if txt(o.progress)}
    <div class="section-head"><h2>Progress</h2></div>
    <div class="card"><Text text={txt(o.progress)} slug={data.slug} /></div>
  {/if}
  {#if txt(o.answer)}
    <div class="section-head"><h2>Your answer</h2></div>
    <div class="card"><Text text={txt(o.answer)} slug={data.slug} /></div>
  {/if}
  <div class="section-head"><h2>Brief</h2></div>
  {#if txt(o.brief)}<div class="card"><Text text={txt(o.brief)} slug={data.slug} /></div>{:else}<div class="empty">No brief was written.</div>{/if}

  {#each groups as g (g.name)}
    <div class="section-head"><h2>{g.name}</h2><span class="count">{g.items.length}</span></div>
    {#if g.items.length}
      <div class="list">{#each g.items as x (x.key)}<RecRow slug={data.slug} rec={x} sub="{x.by} · {when(x.at)}" />{/each}</div>
    {:else}<div class="empty">{g.empty}</div>{/if}
  {/each}

  {#if !FINAL.includes(o.status)}
    <div class="section-head"><h2>Stop this assignment</h2></div>
    {#if !confirming}
      <button type="button" class="btn danger wide tall" onclick={() => (confirming = true)}>Cancel this assignment</button>
    {:else}
      <form method="POST" action="?/cancel" class="card" use:enhance={() => async ({ update }) => { await update(); confirming = false; }}>
        <p><strong>Cancel this assignment?</strong> The agent will stop working on it.</p>
        <label class="field"><span>Why (optional)</span><input name="why" maxlength="500" value={form?.why ?? ""} /></label>
        <div class="two">
          <button class="btn danger tall">Yes, cancel it</button>
          <button type="button" class="btn tall" onclick={() => (confirming = false)}>Keep it</button>
        </div>
      </form>
    {/if}
  {/if}
</div>

<style>
  .back { margin: 0 0 6px; font-size: 13px; color: var(--dim); }
  .back a { display: inline-block; padding: 10px 0; }
  .state { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .card { overflow-wrap: anywhere; }
  .small { font-size: 13px; margin: 8px 0 0; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .tall { min-height: 50px; font-size: 16px; justify-content: center; text-align: center; }
  textarea { width: 100%; font: inherit; }
</style>
