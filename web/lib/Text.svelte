<!-- Free text from records, shown as written (line breaks kept, never as HTML), with record keys like TSK-0007 or
     KNW-N0003 turned into links.   <Text text={rec.body.detail} slug={data.slug} /> -->
<script lang="ts">
  let { text, slug }: { text: string | null | undefined; slug: string } = $props();
  // split() with one capturing group: odd places are the keys.
  // Record keys are 2-6 capitals, a dash, and four or more digits (KNW-N0003 too); not part of a longer code
  // like AB-CD-EFGH-102 or XY-COQ10-1.
  const parts = $derived(String(text ?? "").split(/((?<![\w-])[A-Z]{2,6}-N?\d{4,}(?![\w-]))/g));
</script>

<span class="text">{#each parts as p, i}{#if i % 2}<a href="/c/{slug}/r/{p}">{p}</a>{:else}{p}{/if}{/each}</span>

<style>
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
