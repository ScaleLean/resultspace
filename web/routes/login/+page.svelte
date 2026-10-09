<script lang="ts">
  import { enhance } from "$app/forms";
  let { form } = $props();
</script>

<svelte:head><title>Sign in · ResultSpace</title></svelte:head>
<main class="page auth">
  <h1>ResultSpace</h1>
  <form method="POST" class="card" use:enhance>
    {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
    <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required value={form?.email ?? ""} /></label>
    <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label>
    <button class="btn primary wide">Sign in</button>
  </form>
  <p class="muted">Forgot your password? Whoever runs this server can make a reset link.</p>
</main>
