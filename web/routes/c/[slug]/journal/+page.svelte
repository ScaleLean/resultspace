<script lang="ts">
  import Author from "#lib/Author.svelte";
  import EntryRow from "#lib/EntryRow.svelte";
  let { data, form } = $props();
</script>

<div class="page">
  <h1>Company log</h1>
  <p class="lede">Meaningful outcomes and sourced learning.</p>
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <details class="card">
    <summary class="btn">Record learning or outcome</summary>
    <form method="POST" action="?/log"><Author kind="entry" /><button class="btn primary">Record</button></form>
  </details>
  <div class="list">
    {#each data.entries as e}<EntryRow slug={data.slug} {e} />{/each}
  </div>
</div>
