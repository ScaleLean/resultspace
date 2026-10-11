<script lang="ts">
  import Prose from "#lib/Prose.svelte";
  let { data } = $props();
</script>

<svelte:head><title>{data.company.name} · ResultSpace</title></svelte:head>
<div class="page">
  <h1>{data.company.name}</h1>
  <p class="lede">Project context, company facts and learning.</p>
  <Prose text={data.brief} slug={data.slug} />
  <div class="section-head">
    <h2>Projects</h2>
    <a class="btn" href="/c/{data.slug}/projects">Write a project</a>
  </div>
  <div class="list">
    {#each data.projects as r}<a class="row" href="/c/{data.slug}/r/{r.key}"
        ><strong>{String(r.body.title)}</strong>
        <p>{String(r.body.current_state ?? "")}</p></a
      >{/each}
  </div>
  <h2>Recent learning</h2>
  {#each data.knowledge as r}<p><a href="/c/{data.slug}/r/{r.key}">{String(r.body.title)}</a></p>{/each}
  <h2>Open findings</h2>
  {#each data.flags as r}<p><a href="/c/{data.slug}/r/{r.key}">{String(r.body.title)}</a></p>{/each}<a
    class="btn"
    href="/c/{data.slug}/curator">Review evidence</a
  >
</div>
