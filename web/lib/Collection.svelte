<script lang="ts">
  import Author from "./Author.svelte";
  let { data, form } = $props();
</script>

<svelte:head><title>{data.label} · {data.company.name}</title></svelte:head>
<div class="page">
  <h1>{data.label}</h1>
  <p class="lede">
    {data.kind === "issue_note"
      ? "Unassigned planning notes and questions."
      : data.kind === "fact"
        ? "Company claims with typed values and cited sources."
        : data.kind === "project"
          ? "Goal, objectives, current state and relevant knowledge."
          : data.kind === "source"
            ? "Source documents and citations for company claims."
            : "Sourced learning, including methods that worked in this company."}
  </p>
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
  <details class="card">
    <summary class="btn">Write {data.kind === "issue_note" ? "issue note" : data.kind}</summary>
    <form method="POST" action="?/create"><Author kind={data.kind} /><button class="btn primary">Save</button></form>
  </details>
  <div class="list">
    {#each data.records as r}<a class="row" href="/c/{data.slug}/r/{r.key}"
        ><span class="key">{r.key}</span> <strong>{String(r.body.title)}</strong>
        <p>{String(r.body.current_state ?? r.body.detail ?? r.body.source ?? "").slice(0, 180)}</p></a
      >{/each}
  </div>
</div>

<style>
  form {
    padding: 16px;
  }
  .row {
    display: block;
    overflow-wrap: anywhere;
    min-height: 44px;
  }
</style>
