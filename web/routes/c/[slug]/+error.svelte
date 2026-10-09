<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head><title>{page.status} · ResultSpace</title></svelte:head>
<div class="page">
  <div class="empty">
    <h1>{page.status === 404 ? "Nothing here" : "That did not work"}</h1>
    <p class="muted">{page.error?.message}</p>
    <p><a class="btn" href="/c/{page.params.slug}">Back to Today</a></p>
  </div>
</div>
