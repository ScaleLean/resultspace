<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head><title>{page.status} · ResultSpace</title></svelte:head>
<main class="page">
  <div class="empty">
    <h1>{page.status === 404 ? "Nothing here" : "That did not work"}</h1>
    <p class="muted">{page.error?.message}</p>
    <p><a class="btn" href="/">Back to start</a></p>
  </div>
</main>
