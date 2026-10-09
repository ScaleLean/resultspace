<!-- Agent text as context · headline · rest (see split() in fmt.ts). The rest is clamped to `lines` and opens on tap.
     <Headline text={entry.title} slug={data.slug} />   `href`: make the headline a link. -->
<script lang="ts">
  import Text from "./Text.svelte";
  import { split } from "./fmt.ts";
  let { text, slug, href, lines = 2, strong = false }: { text: string | null | undefined; slug: string; href?: string; lines?: number; strong?: boolean } = $props();
  const s = $derived(split(text));
  let open = $state(false);
</script>

<span class="hl">
  {#if s.context}<span class="ctx">{s.context}</span>{/if}
  {#if href}<a class="head" class:strong {href}><Text text={s.head} {slug} /></a>{:else}<span class="head" class:strong><Text text={s.head} {slug} /></span>{/if}
  {#if s.rest}
    <button type="button" class="rest" class:open style="--lines:{lines}" onclick={() => (open = !open)} aria-expanded={open}>
      <Text text={s.rest} {slug} />
    </button>
  {/if}
</span>

<style>
  .hl { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ctx { font-size: 12px; color: var(--dim); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .head { font-weight: 500; line-height: 1.4; color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
  .head.strong { font-weight: 600; font-size: 16px; }
  a.head:hover { text-decoration: underline; text-decoration-color: var(--line-2); }
  .rest { all: unset; cursor: pointer; color: var(--dim); font-size: 14px; line-height: 1.45; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--lines); overflow: hidden; }
  .rest.open { display: block; -webkit-line-clamp: unset; }
  .rest:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; border-radius: 4px; }
</style>
