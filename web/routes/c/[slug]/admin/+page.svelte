<script lang="ts">
  import { enhance } from "$app/forms";
  import { ago, money, when, words } from "#lib/fmt.ts";
  let { data, form } = $props();

  let busy = $state("");
  let copied = $state(false);
  const cur = $derived(data.curator);
  const s = $derived(cur.settings);
  const cap = $derived(Number(s.daily_cap_usd) || 0);
  const pct = $derived(cap > 0 ? Math.min(100, Math.round((cur.spent_today / cap) * 100)) : 0);
  const duties = [["review", "Review now"], ["briefing", "Write briefing now"], ["upkeep", "Run upkeep now"]] as const;

  // Mark which button is working, and keep what was typed after saving.
  const working = (name: string) => () => {
    busy = name; copied = false;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      try { await update({ reset: name === "addAgent" }); } finally { busy = ""; }
    };
  };
  async function copy(key: string) {
    try { await navigator.clipboard.writeText(key); copied = true; } catch { copied = false; }
  }
  const pick = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).select();
  // New company: the slug follows the name until it is edited by hand. Starts from what a refused post sent back.
  // svelte-ignore state_referenced_locally
  let coName = $state(form?.section === "company" && "name" in form ? form.name : "");
  // svelte-ignore state_referenced_locally
  let coSlug = $state(form?.section === "company" && "slug" in form ? form.slug : "");
  // svelte-ignore state_referenced_locally
  let coSlugTouched = $state(!!coSlug);
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  $effect(() => { if (!coSlugTouched) coSlug = slugify(coName); });
</script>

{#snippet said(section: string)}
  {#if form?.section === section}
    {#if form.error}<p class="error" role="alert">{form.error}</p>{:else if form.done}<p class="notice" role="status">{form.done}</p>{/if}
  {/if}
{/snippet}

<svelte:head><title>Admin · {data.company.name}</title></svelte:head>
<main class="page">
  <h1>Admin</h1>

  <div class="section-head"><h2>Model key</h2><span class="chip {data.modelKey.set ? 'ok' : ''}">{data.modelKey.set ? "set" : "not set"}</span></div>
  <form method="POST" action="?/setKey" class="card" use:enhance={working("setKey")}>
    {@render said("key")}
    <p class="muted">
      {#if data.modelKey.curator}The Curator is on.{:else}The Curator is off until a key is set.{/if}
      It uses a Fireworks key to review what agents write, write your daily briefing and chat. Everything else works without one.
      {#if data.modelKey.set}The key is kept on the server and never shown.{/if}
    </p>
    <label class="field"><span>{data.modelKey.set ? "Replace the key" : "Fireworks key"}</span><input name="key" type="password" class="mono" autocomplete="off" placeholder="fw_…" required /></label>
    <div class="actions">
      <button class="btn" formaction="?/testKey" disabled={busy !== ""}>{busy === "testKey" ? "Testing…" : "Test"}</button>
      <button class="btn primary" disabled={busy !== ""}>{busy === "setKey" ? "Saving…" : "Save"}</button>
    </div>
  </form>

  <div class="section-head"><h2>Curator</h2>{#if cur.available}<span class="chip {s.auto ? 'ok' : ''}">{s.auto ? "works on its own" : "only when asked"}</span>{/if}</div>
  <section class="card">
    {#if !cur.available}<p class="error">The Curator is off: this server has no model key.</p>{/if}
    {@render said("curator")}
    <p class="spend">
      <strong>{money(cur.spent_today)}</strong> spent today
      <span class="muted">{cap > 0 ? `of ${money(cap)} daily limit` : "· no daily limit"}</span>
    </p>
    {#if cap > 0}<div class="bar" role="progressbar" aria-label="Today's spend" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><i class:over={pct >= 100} style="width:{pct}%"></i></div>{/if}

    <div class="actions">
      {#each duties as [duty, label] (duty)}
        <form method="POST" action="?/duty" use:enhance={working(duty)}>
          <input type="hidden" name="duty" value={duty} />
          <button class="btn" disabled={!cur.available || busy !== ""}>{busy === duty ? "Working…" : label}</button>
        </form>
      {/each}
    </div>
    {#if duties.some(([d]) => d === busy)}<p class="muted">This can take a minute. Keep this page open.</p>{/if}

    <details open={!!form && "settings" in form}>
      <summary>Settings</summary>
      <form method="POST" action="?/settings" use:enhance={working("settings")}>
        <label class="check"><input type="checkbox" name="auto" checked={s.auto} /><span>Work on its own <small class="muted">Review what agents write, write the daily briefing and do upkeep without being asked. Chat always works.</small></span></label>
        <label class="field"><span>Model for reviews and chat</span><input name="model" class="mono" value={s.model} required autocapitalize="off" autocorrect="off" spellcheck="false" /></label>
        <label class="field"><span>Stronger model for briefings and upkeep</span><input name="model_strong" class="mono" value={s.model_strong} required autocapitalize="off" autocorrect="off" spellcheck="false" /></label>
        <label class="field"><span>Thinking</span>
          <select name="thinking" value={s.thinking}>{#each ["off", "low", "medium", "high"] as t (t)}<option value={t}>{t}</option>{/each}</select>
        </label>
        <label class="field"><span>Daily limit in dollars (0 = no limit)</span><input name="daily_cap_usd" type="number" inputmode="decimal" min="0" max="1000" step="0.01" value={s.daily_cap_usd} required /></label>
        <label class="field"><span>Standing instructions</span><textarea name="instructions" rows="5" maxlength="8000" placeholder="Added to every run. For example: never approve spending over $50.">{s.instructions}</textarea></label>
        <button class="btn primary" disabled={busy !== ""}>{busy === "settings" ? "Saving…" : "Save settings"}</button>
      </form>
    </details>

    <details>
      <summary>Recent runs <span class="muted">{cur.runs.length}</span></summary>
      {#if cur.runs.length}
        <div class="runs">
          {#each cur.runs as r (r.id)}
            <div class="run">
              <div class="run-top"><strong>{words(r.duty)}</strong><span class="chip {r.status}">{words(r.status)}</span><span class="muted sp">{when(r.started_at)} · {money(r.cost_usd)}</span></div>
              {#if r.detail}<div class="one muted" title={r.detail}>{r.detail}</div>{/if}
            </div>
          {/each}
        </div>
      {:else}<p class="muted pad">No runs yet.</p>{/if}
    </details>
  </section>

  <div class="section-head"><h2>Company brief</h2></div>
  <form method="POST" action="?/brief" class="card" use:enhance={working("brief")}>
    {@render said("brief")}
    <label class="field"><span>What every agent reads first</span><textarea name="brief" rows="9" maxlength="12000" placeholder="What this company does, what matters now, and the rules agents must follow.">{data.brief}</textarea></label>
    <button class="btn primary" disabled={busy !== ""}>{busy === "brief" ? "Saving…" : "Save brief"}</button>
  </form>

  <div class="section-head"><h2>Agents</h2><span class="count">{data.agents.length}</span></div>
  <section class="card">
    {@render said("agents")}
    {#if form?.key}
      <div class="keybox" role="status">
        <p><strong>Copy this key now. It will not be shown again.</strong></p>
        <p class="muted">New key for {form.agent}. Its older keys still work until you revoke them.</p>
        <textarea class="mono" readonly rows="3" aria-label="New key for {form.agent}" onfocus={pick} onclick={pick}>{form.key}</textarea>
        <button type="button" class="btn primary" onclick={() => copy(form.key)}>{copied ? "Copied" : "Copy"}</button>
      </div>
    {/if}
    {#each data.agents as a (a.name)}
      <div class="agent">
        <div class="agent-top">
          <strong class="wrap">{a.name}</strong><span class="chip">{a.role}</span>{#if !a.active}<span class="chip failed">off</span>{/if}
          <span class="muted sp">{a.last_seen ? `seen ${ago(a.last_seen)}` : "never seen"}</span>
        </div>
        <div class="actions">
          <form method="POST" action="?/newKey" use:enhance={working("key:" + a.name)}>
            <input type="hidden" name="name" value={a.name} />
            <button class="btn" disabled={busy !== ""}>New key</button>
          </form>
          <details class="confirm">
            <summary class="btn danger">Revoke keys</summary>
            <form method="POST" action="?/revoke" use:enhance={working("revoke:" + a.name)}>
              <input type="hidden" name="name" value={a.name} />
              <p>Every key of <strong class="wrap">{a.name}</strong> stops working at once. This cannot be undone.</p>
              <button class="btn danger" disabled={busy !== ""}>Yes, revoke every key</button>
            </form>
          </details>
        </div>
      </div>
    {:else}<p class="muted">No agents yet. Add one below, then make a key for it.</p>{/each}

    <details open={form?.section === "agents" && "name" in form}>
      <summary>Add agent</summary>
      <form method="POST" action="?/addAgent" use:enhance={working("addAgent")}>
        <label class="field"><span>Name</span><input name="name" class="mono" required maxlength="63" pattern="[a-z0-9][a-z0-9:._\-]*" placeholder="ads-agent" autocapitalize="off" autocorrect="off" spellcheck="false" value={form && "name" in form ? form.name : ""} /></label>
        <p class="muted hint">Small letters, numbers, and . _ - : only.</p>
        <label class="field"><span>Role</span>
          <select name="role" value="member"><option value="viewer">viewer: can only read</option><option value="member">member: can read and write</option><option value="admin">admin: can also manage agents and kinds</option></select>
        </label>
        <button class="btn primary" disabled={busy !== ""}>Add agent</button>
      </form>
    </details>
  </section>

  <div class="section-head"><h2>Record kinds</h2><span class="count">{data.kinds.length}</span></div>
  <section class="card kinds">
    {#each data.kinds as k (k.kind)}
      <div class="kind">
        <div class="agent-top"><strong class="wrap">{words(k.kind)}</strong><span class="mono muted">{k.prefix}</span><span class="muted sp">{k.live} live{k.archived ? ` · ${k.archived} archived` : ""}</span></div>
        {#if k.statuses?.length}<div class="muted wrap small">{k.statuses.map(words).join(" · ")}</div>{/if}
      </div>
    {:else}<p class="muted">No record kinds yet.</p>{/each}
  </section>

  <div class="section-head"><h2>New company</h2></div>
  <form method="POST" action="?/newCompany" class="card" use:enhance={working("newCompany")}>
    {@render said("company")}
    <p class="muted">Each company keeps its own work, journal, knowledge, skills and agent keys.</p>
    <label class="field"><span>Name</span><input name="name" required maxlength="120" placeholder="Acme" bind:value={coName} /></label>
    <label class="field"><span>Slug <small class="muted">in web addresses</small></span><input name="slug" class="mono" required maxlength="63" pattern="[a-z0-9][a-z0-9\-]*" autocapitalize="off" autocorrect="off" spellcheck="false" bind:value={coSlug} oninput={() => (coSlugTouched = true)} /></label>
    <p class="muted hint">Lower-case letters, digits and dashes.</p>
    <button class="btn primary" disabled={busy !== ""}>{busy === "newCompany" ? "Making…" : "Make company"}</button>
  </form>
</main>

<style>
  .page{overflow-wrap:anywhere}
  .wrap{overflow-wrap:anywhere;min-width:0}.small{font-size:12.5px}.sp{margin-left:auto;font-size:12.5px;text-align:right}
  .spend{margin:0 0 8px}
  .bar{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:0 0 4px}
  .bar i{display:block;height:100%;background:var(--green);border-radius:99px}.bar i.over{background:var(--red)}
  .actions form{display:contents}
  details{border-top:1px solid var(--line);margin:0 -14px;padding:0 14px}
  details:last-child{margin-bottom:-14px}
  summary{min-height:48px;display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary:not(.btn)::after{content:"+";margin-left:auto;color:var(--dim);font-size:18px}
  details[open]>summary:not(.btn)::after{content:"−"}
  details>form,details>.runs{padding:4px 0 14px}.pad{padding-bottom:6px}
  .check{display:flex;gap:10px;align-items:flex-start;min-height:44px;margin:0 0 12px;font-weight:600;cursor:pointer}
  .check input{width:22px;height:22px;margin:1px 0 0;flex:none;accent-color:var(--ink)}
  .check small{display:block;font-weight:400;font-size:12.5px}
  .field input.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px}
  .field small{font-weight:400}
  .hint{font-size:12.5px;margin:-6px 0 12px}
  .run{padding:8px 0;border-top:1px solid var(--line);min-width:0}.run:first-child{border-top:0}
  .run-top,.agent-top{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px}
  .one{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .agent{padding:10px 0 2px;border-top:1px solid var(--line)}.agent:first-of-type{border-top:0;padding-top:0}
  .agent .actions{margin:8px 0}
  details.confirm{border:0;margin:0;padding:0}details.confirm[open]{flex-basis:100%}
  details.confirm>summary{min-height:44px;display:inline-flex}
  details.confirm>form{padding:10px 0 4px}
  .keybox{border:2px solid var(--amber);border-radius:10px;padding:12px;margin:0 0 14px}
  .keybox p{margin:0 0 8px}
  .keybox textarea{display:block;width:100%;padding:10px;margin:0 0 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-size:14px;overflow-wrap:anywhere;word-break:break-all;resize:none}
  .kind{padding:8px 0;border-top:1px solid var(--line)}.kind:first-child{border-top:0;padding-top:0}.kind:last-child{padding-bottom:0}
</style>
