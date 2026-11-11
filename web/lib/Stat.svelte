<!-- A number with its label, for summary strips. <Stat n={3} label="Need you" tone="amber" href="#needs" /> -->
<script lang="ts">
  let { n, label, tone = "", href }: { n: number | string; label: string; tone?: string; href?: string } = $props();
</script>

<svelte:element this={href ? "a" : "div"} class="stat {tone}" {href}>
  <span class="n">{n}</span><span class="l">{label}</span>
</svelte:element>

<style>
  .stat { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); text-decoration: none; min-width: 0; }
  a.stat:hover { background: var(--card-2); }
  .n { font-size: 22px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .l { font-size: 12.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .amber .n { color: var(--amber); } .green .n { color: var(--green); } .blue .n { color: var(--blue); } .violet .n { color: var(--violet); }
  .zero .n { color: var(--faint); }
</style>
