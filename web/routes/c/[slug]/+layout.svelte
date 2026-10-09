<!-- One company inside the app frame (web/lib/Shell.svelte). Pages start with <div class="page"> (see web/app.css, docs/design/UI.md). -->
<script lang="ts">
  import Shell from "#lib/Shell.svelte";
  let { data, children } = $props();
</script>

<Shell companies={data.rail} slug={data.slug}>{@render children()}</Shell>
