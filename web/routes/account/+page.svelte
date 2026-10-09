<script lang="ts">
  import { enhance } from "$app/forms";
  let { data, form } = $props();
</script>

<svelte:head><title>Account · ResultSpace</title></svelte:head>
<main class="page narrow">
  <p><a href={data.back}>&larr; Back</a></p>
  <h1>Account</h1>
  {#if data.trusted}
    <div class="card">
      <b>From here, nobody signs in.</b>
      <p class="muted">This browser is on the machine that runs ResultSpace, or on its Tailscale network, so it is the owner.</p>
    </div>
    <div class="section-head"><h2>From anywhere else</h2></div>
    {#if data.account}
      <div class="card">
        <p><b>{data.account.email}</b> can sign in from any network with a password.</p>
        <form method="POST" action="?/set" use:enhance>
          {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
          {#if form?.done}<p class="notice">The password is set.</p>{/if}
          <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password" required /></label>
          <label class="field"><span>New password again</span><input name="again" type="password" autocomplete="new-password" required /></label>
          <button class="btn">Set the password</button>
        </form>
        <p class="muted">You can set it from here without the old one, because you are already in. Signing in from elsewhere needs this password.</p>
      </div>
    {:else}
      <div class="card">
        <p>No account yet, so ResultSpace can only be used from here. To sign in from another network, make one.</p>
        <form method="POST" action="?/account" use:enhance>
          {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
          {#if form?.made}<p class="notice">Made. From elsewhere, sign in with that email and password.</p>{/if}
          <label class="field"><span>Name</span><input name="name" required autocomplete="username" /></label>
          <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email" /></label>
          <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="new-password" minlength="12" /></label>
          <label class="field"><span>Password again</span><input name="again" type="password" required autocomplete="new-password" /></label>
          <button class="btn primary">Make the account</button>
        </form>
      </div>
    {/if}
  {:else}
    <div class="card"><b>{data.person.name}</b>{#if data.person.email}<div class="muted">{data.person.email}</div>{/if}</div>
    <div class="section-head"><h2>Change password</h2></div>
    <form method="POST" action="?/password" class="card" use:enhance>
      {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
      {#if form?.done}<p class="notice">Your password is changed.</p>{/if}
      <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required /></label>
      <label class="field"><span>New password</span><input name="next" type="password" autocomplete="new-password" required /></label>
      <label class="field"><span>New password again</span><input name="again" type="password" autocomplete="new-password" required /></label>
      <button class="btn primary">Change password</button>
    </form>
    <div class="section-head"><h2>Sign out</h2></div>
    <form method="POST" action="?/signout" use:enhance><button class="btn danger">Sign out</button></form>
  {/if}
</main>
