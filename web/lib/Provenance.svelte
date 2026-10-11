<script lang="ts">
  import { when } from "./fmt.ts";
  import type { provenance } from "../../src/core/records.ts";
  let { value, claim = true }: { value: ReturnType<typeof provenance>; claim?: boolean } = $props();
</script>
<p class="meta">{claim ? "Claim asserted" : "Current content"}: {value.provenance.actor} · {when(value.provenance.at)} · revision {value.provenance.rev}</p>
<p class="meta">Last edited: {value.last_edited.actor} · {when(value.last_edited.at)} · revision {value.last_edited.rev}</p>
<p class="meta">Citations last changed: {value.citation_provenance.actor} · {when(value.citation_provenance.at)} · revision {value.citation_provenance.rev}</p>
<details>
  <summary>Original record: {value.original.actor} · {when(value.original.at)} · revision {value.original.rev}</summary>
  <pre>{JSON.stringify(value.original.body, null, 2)}</pre>
</details>
<style>pre { white-space: pre-wrap; overflow-wrap: anywhere; }</style>
