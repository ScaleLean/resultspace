<script lang="ts">
  import Collection from "#lib/Collection.svelte";
  let { data, form } = $props();
</script>

<Collection {data} {form} />
