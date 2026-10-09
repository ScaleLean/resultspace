<!-- The body of a record, readable: long text as paragraphs, short values in a label/value list, nested values folded
     as JSON, and technical fields (names starting with "_", ids of other records) behind one "Details" toggle.
     <Fields body={rec.body} slug={data.slug} skip={["title", "status"]} /> -->
<script lang="ts">
  import Prose from "./Prose.svelte";
  import Text from "./Text.svelte";
  import { when, words } from "./fmt.ts";

  let { body, slug, skip = [] }: { body: Record<string, unknown>; slug: string; skip?: string[] } = $props();

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const label = (k: string) => { const w = words(k.replace(/^_+/, "")); return w.charAt(0).toUpperCase() + w.slice(1); };
  const isRef = (v: unknown): boolean => (typeof v === "string" ? UUID.test(v) : Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && UUID.test(x)));
  const isLong = (v: unknown): v is string => typeof v === "string" && (v.length > 80 || v.includes("\n"));
  const isNested = (v: unknown) => typeof v === "object" && v !== null;
  const show = (v: unknown): string => (typeof v === "boolean" ? (v ? "yes" : "no") : typeof v === "string" && ISO.test(v) ? when(v) || v : String(v));
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const size = (v: unknown) => (Array.isArray(v) ? `${v.length}` : `${Object.keys(v as object).length}`);

  const all = $derived(Object.entries(body ?? {}).filter(([k, v]) => !skip.includes(k) && v !== null && v !== undefined && v !== ""));
  const hidden = $derived(all.filter(([k, v]) => k.startsWith("_") || isRef(v)));
  const open = $derived(all.filter(([k, v]) => !k.startsWith("_") && !isRef(v)));
  const long = $derived(open.filter(([, v]) => isLong(v)));
  const nested = $derived(open.filter(([, v]) => isNested(v)));
  const shorts = $derived(open.filter(([, v]) => !isLong(v) && !isNested(v)));
</script>

{#if shorts.length}
  <dl class="kv facts">
    {#each shorts as [k, v] (k)}
      <dt>{label(k)}</dt>
      <dd>{#if typeof v === "string" && !ISO.test(v)}<Text text={v} {slug} />{:else}{show(v)}{/if}</dd>
    {/each}
  </dl>
{/if}

{#each long as [k, v] (k)}
  <section class="long">
    <h3>{label(k)}</h3>
    <Prose text={String(v)} {slug} lines={long.length > 1 ? 8 : 14} />
  </section>
{/each}

{#each nested as [k, v] (k)}
  <details class="fold">
    <summary>{label(k)} <span class="muted">({size(v)})</span></summary>
    <pre>{json(v)}</pre>
  </details>
{/each}

{#if hidden.length}
  <details class="fold">
    <summary>Details <span class="muted">({hidden.length})</span></summary>
    <dl class="kv">
      {#each hidden as [k, v] (k)}
        <dt>{label(k)}</dt>
        <dd>{#if isNested(v)}<pre>{json(v)}</pre>{:else}<span class="mono">{String(v)}</span>{/if}</dd>
      {/each}
    </dl>
  </details>
{/if}

{#if !all.length}<p class="muted">No other fields.</p>{/if}

<style>
  .facts { margin: 0 0 18px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
  .facts:last-child { border: 0; margin: 0; padding: 0; }
  .long { margin: 0 0 18px; }
  .long:last-of-type { margin-bottom: 4px; }
  .long h3 { margin: 0 0 6px; font-size: 12.5px; font-weight: 600; color: var(--dim); letter-spacing: .02em; }
  .fold { margin-top: 10px; }
  .fold summary { cursor: pointer; min-height: 40px; display: flex; align-items: center; gap: 6px; font-weight: 550; font-size: 13.5px; color: var(--dim); }
  .fold summary:hover { color: var(--ink); }
  pre { margin: 0; padding: 10px; overflow-x: auto; font-size: 0.8rem; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 8px; }
  dd { overflow-wrap: anywhere; min-width: 0; }
</style>
