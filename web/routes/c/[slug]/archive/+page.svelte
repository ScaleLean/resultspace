<script lang="ts">
  let { data } = $props();
</script>

<div class="page">
  <h1>Legacy archive</h1>
  <p>Retired records remain read-only at their original keys. History, sources and attachments are preserved.</p>
  {#each data.records as r}<p>
      <a class="btn" href="/c/{data.slug}/r/{r.key}">{r.key} · {String(r.body.title ?? r.body.name ?? r.kind)}</a>
    </p>{/each}
</div>
