<script lang="ts">
  let { data } = $props();
  const links = $derived([
    ["Knowledge", `/c/${data.slug}/knowledge`, "What we know"],
    ["Skills", `/c/${data.slug}/skills`, "How we do things"],
    ["Curator", `/c/${data.slug}/curator`, "Chat with the Curator"],
    ["Search", `/c/${data.slug}/search`, "Find any record"],
    ["Activity", `/c/${data.slug}/activity`, "Everything that changed"],
    ["Admin", `/c/${data.slug}/admin`, "Agents, keys and settings"],
    ["Account", "/account", data.trusted ? "Who can get in, and from where" : "Password and sign out"],
    ["All companies", "/", "Home: what needs you, everywhere"],
  ]);
</script>

<svelte:head><title>More · {data.company.name}</title></svelte:head>
<div class="page">
  <h1>More</h1>
  <div class="list">
    {#each links as [label, href, sub]}
      <a class="row big" {href}><span class="row-main"><span class="row-title">{label}</span><span class="row-sub">{sub}</span></span><span class="muted" aria-hidden="true">&rsaquo;</span></a>
    {/each}
  </div>
</div>
