<!-- One Journal entry: type icon, headline (with the rest folded), and who · project · time.
     <EntryRow slug={data.slug} e={entry} />   e: { key, type, at, by, title, detail?, project?, about? } -->
<script lang="ts">
  import Avatar from "./Avatar.svelte";
  import Headline from "./Headline.svelte";
  import TypeIcon from "./TypeIcon.svelte";
  import { actor, clock } from "./fmt.ts";
  type E = { key: string; type: string; at: string; by: string; title: string; detail?: unknown; project?: string | null; about?: { key: string; title: string } | null };
  let { slug, e, projects, showDay = false, here }: { slug: string; e: E; projects?: Map<string, string>; showDay?: boolean; here?: string } = $props();
  // `here`: the record whose page this is; a link back to it is left out.
  const project = $derived(e.project && e.project !== here ? (projects?.get(e.project) ?? e.project) : null);
</script>

<div class="entry">
  <TypeIcon type={e.type} />
  <div class="body">
    <Headline text={e.title} {slug} />
    <div class="meta">
      <Avatar who={e.by} {slug} size={18} label />
      {#if project}<span class="dot">·</span><a href="/c/{slug}/r/{e.project}">{project}</a>{/if}
      {#if e.about && e.about.key !== e.project && e.about.key !== here && !e.title.toLowerCase().includes(e.about.title.toLowerCase().slice(0, 30))}<span class="dot">·</span><a href="/c/{slug}/r/{e.about.key}" class="about">{e.about.title}</a>{/if}
      <span class="sp"></span>
      <a class="when" href="/c/{slug}/r/{e.key}" title="{e.key} · {e.at}">{showDay ? new Date(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " : ""}{clock(e.at)}</a>
    </div>
  </div>
</div>

<style>
  .entry { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); }
  .entry:first-child { border-top: 0; }
  .body { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .meta { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--dim); min-width: 0; }
  .meta a { text-decoration: none; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .meta a:hover { color: var(--ink); }
  .dot { color: var(--faint); }
  .sp { flex: 1; }
  .when { flex: none; font-variant-numeric: tabular-nums; color: var(--faint) !important; min-height: 24px; display: inline-flex; align-items: center; }
  .about { max-width: 40%; }
</style>
