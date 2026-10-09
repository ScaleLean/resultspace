<!-- One record as a list row linking to its page. Put rows inside <div class="list">.
     <RecRow slug={data.slug} rec={r} sub="optional second line" />
     `rec` is a Rec (src/core/records.ts) or any line with a key; `title` / `status` on the line win over the body. -->
<script lang="ts">
  import type { Rec } from "../../src/core/records.ts";
  import { ago, words } from "./fmt.ts";
  type Line = Partial<Rec> & { key: string; title?: string | null; status?: string | null; at?: string | null };
  let { slug, rec, sub }: { slug: string; rec: Line; sub?: string | null } = $props();
  const pick = (v: unknown) => (typeof v === "string" && v ? v : "");
  const title = $derived(pick(rec.title) || pick(rec.body?.title) || pick(rec.body?.name) || rec.key);
  const status = $derived(pick(rec.status) || pick(rec.body?.status));
</script>

<a class="row" href="/c/{slug}/r/{rec.key}">
  <span class="row-main">
    <span class="row-title">{title}</span>
    {#if sub}<span class="row-sub">{sub}</span>{/if}
    <span class="row-sub">{rec.key}{#if rec.kind} · {words(rec.kind)}{/if} · {ago(rec.updated_at ?? rec.at)}</span>
  </span>
  {#if status}<span class="chip {status}">{words(status)}</span>{/if}
</a>
