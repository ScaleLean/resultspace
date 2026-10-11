<script lang="ts">
  let { data } = $props();
</script>

<div class="page">
  <h1>Knowledge and review</h1>
  {#each [["knowledge", "Knowledge"], ["facts", "Facts"], ["sources", "Sources"], ["issues", "Issue notes"], ["curator", "Curator"], ["search", "Search"], ["archive", "Legacy archive"], ["activity", "History"], ["admin", "Admin"]] as [path, label]}<p
    >
      <a class="btn" href="/c/{data.slug}/{path}">{label}</a>
    </p>{/each}
</div>
