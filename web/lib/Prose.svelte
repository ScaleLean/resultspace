<!-- Long free text as readable paragraphs: keys linked, long paths shortened, clamped after `lines` with "Show all".
     <Prose text={rec.body.working_notes} slug={data.slug} lines={10} /> -->
<script lang="ts">
  import Text from "./Text.svelte";
  import { shortPath } from "./fmt.ts";
  let { text, slug, lines = 10 }: { text: string | null | undefined; slug: string; lines?: number } = $props();
  const paras = $derived(String(text ?? "").split(/\n{2,}|\n(?=[A-Z][a-z]+ \d{1,2}, \d{4}|LATEST|Evidence:)/).map((p) => p.trim()).filter(Boolean)
    .map((p) => p.replace(/(\/home\/[^\s,;)]+)/g, (m) => shortPath(m))));
  const long = $derived(String(text ?? "").length > lines * 70);
  let open = $state(false);
</script>

<div class="prose" class:clamped={long && !open} style="--lines:{lines}">
  {#each paras as p}<p><Text text={p} {slug} /></p>{/each}
</div>
{#if long}<button type="button" class="more" onclick={() => (open = !open)}>{open ? "Show less" : "Show all"}</button>{/if}

<style>
  .prose { font-size: 15px; line-height: 1.6; color: var(--ink-2); max-width: 68ch; }
  .prose p { margin: 0 0 10px; }
  .prose p:last-child { margin-bottom: 0; }
  .clamped { max-height: calc(var(--lines) * 1.6em); overflow: hidden; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
  .more { all: unset; cursor: pointer; font-weight: 600; font-size: 14px; min-height: 44px; display: inline-flex; align-items: center; color: var(--ink); }
  .more:focus-visible { outline: 2px solid var(--blue); border-radius: 4px; }
</style>
