<script lang="ts">
  import { enhance } from "$app/forms";
  let { data, form } = $props();

  // The slug follows the name until it is edited by hand. Starts from what a refused post sent back.
  // svelte-ignore state_referenced_locally
  let name = $state(form?.name ?? "");
  // svelte-ignore state_referenced_locally
  let slug = $state(form?.slug ?? "");
  // svelte-ignore state_referenced_locally
  let slugTouched = $state(!!form?.slug);
  let busy = $state("");
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  $effect(() => { if (!slugTouched) slug = slugify(name); });
  const working = (what: string) => () => {
    busy = what;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => { try { await update({ reset: false }); } finally { busy = ""; } };
  };
</script>

<svelte:head><title>Set up · ResultSpace</title></svelte:head>
<main class="page auth setup">
  <h1>Set up ResultSpace</h1>
  {#if data.face === "account"}
    <p class="muted">This server has no account yet. Make yours: you will be its owner.</p>
    <form method="POST" action="?/account" class="card" use:enhance>
      {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
      <label class="field"><span>Your name</span><input name="name" autocomplete="name" required value={form?.name ?? ""} /></label>
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required value={form?.email ?? ""} /></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" required /></label>
      <button class="btn primary wide">Create account</button>
    </form>
  {:else}
    {#if data.mode === "trusted"}
      <p class="muted">ResultSpace runs on this machine. Nobody needs to sign in from here.</p>
    {:else}
      <p class="muted">Your account is ready. Now make the first company.</p>
    {/if}
    <form method="POST" action="?/company" class="card" use:enhance={working("company")}>
      {#if form?.error}
        <p class="error" role="alert">{form.error}</p>
        {#if form.created}<p><a class="btn wide" href="/c/{form.created}">Go on without a key</a></p>{/if}
      {/if}
      <label class="field"><span>Company name</span><input name="name" required maxlength="120" placeholder="Acme" bind:value={name} /></label>
      <label class="field"><span>Slug <small class="muted">in web addresses</small></span><input name="slug" class="mono" required maxlength="63" pattern="[a-z0-9][a-z0-9\-]*" autocapitalize="off" autocorrect="off" spellcheck="false" bind:value={slug} oninput={() => (slugTouched = true)} /></label>
      <p class="muted hint">Lower-case letters, digits and dashes.</p>

      <div class="keyhead"><span>Fireworks key</span><span class="muted">optional</span></div>
      <p class="muted hint">The Curator uses it to review what agents write, write your daily briefing and chat. Everything else works without a key; you can add one later in Admin.</p>
      <div class="keyrow">
        <input name="key" type="password" class="mono" autocomplete="off" placeholder="fw_…" aria-label="Fireworks key" />
        <button class="btn" formaction="?/testKey" disabled={busy !== ""}>{busy === "testKey" ? "Testing…" : "Test key"}</button>
      </div>
      {#if form?.tested}<p class={form.testedOk ? "notice" : "error"} role="status">{form.tested}</p>{/if}
      <button class="btn primary wide" disabled={busy !== ""}>{busy === "company" ? "Making…" : "Make company"}</button>
    </form>
  {/if}
</main>

<style>
  .setup{max-width:480px}
  .hint{font-size:12.5px;margin:-6px 0 12px}
  .field .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px}
  .field small{font-weight:400}
  .keyhead{display:flex;gap:8px;font-size:13px;font-weight:600;margin:0 0 4px}.keyhead .muted{font-weight:400}
  .keyrow{display:flex;gap:8px;margin:0 0 12px}.keyrow input{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px}
</style>
