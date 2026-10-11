<script lang="ts">
  import Shell from "#lib/Shell.svelte";
  let { data } = $props();
</script>

<svelte:head><title>Companies · ResultSpace</title></svelte:head>
<Shell companies={data.rail}
  ><div class="page">
    <h1>Company knowledge</h1>
    <p class="lede">Projects, facts and learning, kept in each company's own space.</p>
    <div class="list">
      {#each data.companies as c}<a class="row" href="/c/{c.slug}">{c.name}</a>{/each}
    </div>
    <a class="btn" href="/account">Account</a>
  </div></Shell
>
