<script lang="ts">
  import { enhance } from "$app/forms";
  let { form } = $props();
  let token = $state("");
  $effect(() => { token = location.hash.slice(1); });
</script>

<svelte:head><title>New password · ResultSpace</title></svelte:head>
<main class="page auth">
  <h1>New password</h1>
  {#if form?.done}
    <p class="notice">Your password is changed.</p>
    <a class="btn primary wide" href="/login">Sign in</a>
  {:else}
    <form method="POST" class="card" use:enhance>
      {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
      <input type="hidden" name="token" value={token} />
      <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password" required /></label>
      <label class="field"><span>Again</span><input name="again" type="password" autocomplete="new-password" required /></label>
      <button class="btn primary wide">Set password</button>
    </form>
  {/if}
</main>
