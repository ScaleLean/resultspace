<!-- A search snippet. The search marks matched words as [word]; those become <mark>. Everything is rendered as text. -->
<script lang="ts">
  let { text }: { text: string | null | undefined } = $props();
  // split() with one capturing group: odd places are the matches.
  const parts = $derived(String(text ?? "").split(/\[([^\[\]\n]{1,80})\]/g));
</script>

<span class="row-sub snip">{#each parts as p, i}{#if i % 2}<mark>{p}</mark>{:else}{p}{/if}{/each}</span>

<style>
  .snip { white-space: normal; overflow-wrap: anywhere; }
  mark { background: color-mix(in srgb, var(--hi) 55%, transparent); color: var(--ink); border-radius: 3px; padding: 0 1px; }
</style>
