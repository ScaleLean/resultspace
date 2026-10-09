<!-- A face for an actor string.  <Avatar who="hermes:acme" slug={data.slug} /> ; size in px (default 22). -->
<script lang="ts">
  import { actor } from "./fmt.ts";
  let { who, slug, size = 22, label = false }: { who: string | null | undefined; slug?: string; size?: number; label?: boolean } = $props();
  const a = $derived(actor(who, slug));
</script>

<span class="av-wrap" title={a.name}>
  <span class="av {a.kind}" style="--h:{a.hue};width:{size}px;height:{size}px;font-size:{Math.round(size * 0.45)}px" aria-hidden="true">{a.initials}</span>
  {#if label}<span class="av-name">{a.short}</span>{/if}
</span>

<style>
  .av-wrap { display: inline-flex; align-items: center; gap: 7px; min-width: 0; vertical-align: middle; }
  .av { border-radius: 50%; display: inline-grid; place-items: center; font-weight: 650; flex: none; letter-spacing: 0;
    color: hsl(var(--h) 55% 78%); background: hsl(var(--h) 25% 20%); }
  .av.curator { color: var(--violet); background: var(--violet-bg); }
  .av.system { color: var(--dim); background: var(--hover); }
  .av.person { color: var(--bg); background: var(--ink); }
  .av-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
