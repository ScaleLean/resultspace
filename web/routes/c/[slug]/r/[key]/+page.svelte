<script lang="ts">
  import { when } from "#lib/fmt.ts";
  import Author from "#lib/Author.svelte";
  import Prose from "#lib/Prose.svelte";
  let { data, form } = $props();
  const rec = $derived(data.record);
  const title = $derived(String(rec.body.title ?? rec.body.name ?? rec.key));
</script>

<svelte:head><title>{title} · {data.company.name}</title></svelte:head>
<div class="page">
  <p class="meta">{rec.key} · {rec.kind} · revision {rec.rev}</p>
  <h1>{title}</h1>
  {#if data.legacy}<p class="notice">Read-only legacy archive. Original keys, content and history are preserved.</p>{/if}
  {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}{#if form?.saved}<p class="notice">{form.saved}</p>{/if}
  {#each Object.entries(rec.body).filter(([k]) => !["title", "name", "evidence", "signature", "value_type"].includes(k) && !k.endsWith("_id") && !k.endsWith("_ids") && !k.startsWith("_")) as [k, v]}<section
    >
      <h2>{k.replaceAll("_", " ")}</h2>
      {#if typeof v === "string"}<Prose text={v} slug={data.slug} />{:else if Array.isArray(v)}<ul>
          {#each v as item}<li>{typeof item === "object" ? JSON.stringify(item) : String(item)}</li>{/each}
        </ul>{:else}<p>{String(v)}</p>{/if}
    </section>{/each}
  {#if data.project}<h2>Focused project context</h2>
    <p>{data.project.scope}</p>
    {#if data.project.truncated}<p class="notice">Some context is omitted. Read the linked records for more.</p>{/if}
    {#each [["facts", data.project.facts], ["knowledge", data.project.knowledge], ["issues", data.project.issues], ["log", data.project.log], ["findings", data.project.findings]] as [label, items]}<h2
      >
        {label === "log" ? "Chronological log" : label}
      </h2>
      <div class="list">
        {#each items as e}<article class="card">
            <a class="btn" href="/c/{data.slug}/r/{e.record.key}">{String(e.record.body.title)}</a>
            <p>{String(e.record.body.detail ?? e.record.body.body ?? e.record.body.value ?? "")} {String(e.record.body.unit ?? "")}</p>
            <p class="meta">{e.provenance.actor} · {when(e.provenance.at)} · revision {e.provenance.rev}</p>
            {#each e.sources as source}<a class="btn" href="/c/{data.slug}/r/{source.key}">Source: {String(source.body.title)}</a>{/each}
          </article>{/each}
      </div>{/each}{/if}
  {#if Array.isArray(rec.body.evidence)}<h2>Evidence at review</h2>
    {#each rec.body.evidence as e}<article class="card">
        <a href="/c/{data.slug}/r/{e.record.key}">{e.record.key}: {e.record.body.title}</a>
        <p>Revision {e.provenance.rev} · {e.provenance.actor} · {when(e.provenance.at)}</p>
        <pre>{JSON.stringify(e.record.body, null, 2)}</pre>
        {#each e.sources as source}<p><a href="/c/{data.slug}/r/{source.key}">{source.key}: {source.body.title}</a></p>{/each}
      </article>{/each}{/if}
  <h2>References</h2>
  {#each [...data.links.out, ...data.links.in] as l}<p><a class="btn" href="/c/{data.slug}/r/{l.key}">{l.key} · {l.title}</a></p>{/each}
  {#if !data.legacy}<details class="card">
      <summary class="btn">Edit {rec.kind}</summary>
      <form method="POST" action="?/patch">
        <input type="hidden" name="rev" value={rec.rev} /><Author kind={rec.kind} body={rec.body} /><label class="field"
          ><span>Reason or source for this change</span><input name="why" /></label
        ><button class="btn primary">Save revision</button>
      </form>
    </details>
    <form method="POST" action={rec.archived ? "?/restore" : "?/archive"}>
      <button class="btn">{rec.archived ? "Restore" : "Archive"}</button>
    </form>
    {#if data.history.length > 1}<form method="POST" action="?/undo">
        <input type="hidden" name="rev" value={rec.rev} /><button class="btn">Undo latest change</button>
      </form>{/if}{/if}
  <h2>History and provenance</h2>
  {#each [...data.history].reverse() as v}<details class="card">
      <summary class="btn">Revision {v.rev} · {v.actor} · {v.op} · {v.at}</summary>
      <p>{v.why ?? ""}</p>
      <pre>{JSON.stringify(v.body, null, 2)}</pre>
    </details>{/each}
</div>

<style>
  .card {
    padding: 12px;
    margin: 10px 0;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  form {
    margin: 12px 0;
  }
  section {
    overflow-wrap: anywhere;
  }
</style>
