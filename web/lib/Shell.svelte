<!-- The app frame. Desktop: a rail with Home (every company), then each company with a live dot and what waits;
     the open company unfolds into its sections. Phone: a top bar, and inside a company a tab bar.
       <Shell companies={data.rail} slug={data.slug}>…page…</Shell>      (slug null = the home page) -->
<script lang="ts">
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import type { RailCompany } from "./server/pulse.ts";
  let { companies, slug = null, children }: { companies: RailCompany[]; slug?: string | null; children: Snippet } = $props();

  const ICON: Record<string, string> = {
    home: "M4 5h16v6H4z M4 14h7v5H4z M14 14h6v5h-6z",
    today: "M3 11l9-7 9 7v9H3z M9 20v-6h6v6",
    curator: "M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z",
    journal: "M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h3",
    work: "M4 8h16v11H4z M9 8V5h6v3",
    skills: "M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z",
    knowledge: "M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z M20 5h-7 M20 5v13h-7",
    search: "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4",
    activity: "M3 12h4l3-8 4 16 3-8h4",
    admin: "M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2",
    account: "M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M4 21a8 8 0 0 1 16 0",
    more: "M5 12h.01 M12 12h.01 M19 12h.01",
    back: "M15 5l-7 7 7 7",
  };
  const current = $derived(companies.find((c) => c.slug === slug) ?? null);
  const total = $derived(companies.reduce((n, c) => n + c.needs, 0));
  const base = $derived(slug ? `/c/${slug}` : "");
  const sections = $derived(slug ? [
    { id: "today", label: "Overview", href: base },
    { id: "work", label: "Work", href: `${base}/work` },
    { id: "journal", label: "Journal", href: `${base}/journal` },
    { id: "knowledge", label: "Knowledge", href: `${base}/knowledge` },
    { id: "skills", label: "Skills", href: `${base}/skills` },
    { id: "curator", label: "Curator", href: `${base}/curator` },
    { id: "search", label: "Search", href: `${base}/search` },
    { id: "activity", label: "Activity", href: `${base}/activity` },
    { id: "admin", label: "Admin", href: `${base}/admin` },
  ] : []);
  const tabs = $derived(slug ? [
    { id: "home", label: "Home", href: "/" },
    { id: "today", label: "Overview", href: base },
    { id: "work", label: "Work", href: `${base}/work` },
    { id: "journal", label: "Journal", href: `${base}/journal` },
    { id: "more", label: "More", href: `${base}/more` },
  ] : []);
  const path = $derived(page.url.pathname);
  const on = (href: string) => (href === base || href === "/" ? path === href || path === `${href}/` : path === href || path.startsWith(href + "/"));
  const tabOn = (t: { id: string; href: string }) => (t.id === "more" ? !tabs.some((x) => x.id !== "more" && on(x.href)) : on(t.href));
  const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
</script>

{#snippet ic(id: string)}<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[id]} /></svg>{/snippet}
{#snippet mark(c: RailCompany, size = 24)}<span class="mark" style="--h:{hue(c.slug)};width:{size}px;height:{size}px">{initials(c.name)}</span>{/snippet}

<div class="shell">
  <nav class="rail" aria-label="Companies">
    <a class="brand" href="/"><span class="logo">RS</span><span>ResultSpace</span></a>
    <a class="nav" class:on={on("/")} href="/" aria-current={on("/") ? "page" : undefined}>
      {@render ic("home")}<span>Home</span>{#if total}<span class="badge" aria-label="{total} waiting for you">{total}</span>{/if}
    </a>
    <div class="label">Companies</div>
    {#each companies as c (c.slug)}
      <a class="co" class:open={c.slug === slug} href="/c/{c.slug}">
        {@render mark(c)}<span class="nm">{c.name}</span>
        {#if c.needs}<span class="badge">{c.needs}</span>{:else}<span class="dot {c.working ? 'live' : 'quiet'}" title={c.working ? "Agent working now" : "Agent idle"}></span>{/if}
      </a>
      {#if c.slug === slug}
        <div class="sections">
          {#each sections as n}<a class="nav sub" class:on={on(n.href)} href={n.href} aria-current={on(n.href) ? "page" : undefined}>{@render ic(n.id)}<span>{n.label}</span></a>{/each}
        </div>
      {/if}
    {/each}
    <div class="grow"></div>
    <a class="nav" class:on={on("/account")} href="/account">{@render ic("account")}<span>Account</span></a>
  </nav>

  <header class="top">
    {#if current}
      <a class="iconbtn" href="/" aria-label="All companies">{@render ic("back")}</a>
      {@render mark(current, 26)}<span class="top-nm">{current.name}</span>
      <a class="iconbtn" href="{base}/search" aria-label="Search">{@render ic("search")}</a>
      <a class="iconbtn" href="{base}/curator" aria-label="Curator">{@render ic("curator")}</a>
    {:else}
      <span class="logo">RS</span><span class="top-nm">ResultSpace</span>
      <a class="iconbtn" href="/account" aria-label="Account">{@render ic("account")}</a>
    {/if}
  </header>

  <main class="main" class:has-tabs={!!slug}>{@render children()}</main>

  {#if slug}
    <nav class="tabbar" aria-label="Sections">
      {#each tabs as t}
        <a href={t.href} class:on={tabOn(t)} aria-current={tabOn(t) ? "page" : undefined}>
          {@render ic(t.id)}<span>{t.label}</span>
          {#if t.id === "home" && total}<span class="badge">{total}</span>{/if}
        </a>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .brand { display: flex; align-items: center; gap: 10px; padding: 6px 8px 18px; text-decoration: none; font-weight: 680; letter-spacing: -.03em; font-size: 15px; }
  .logo { width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; background: var(--teal); color: #0d201c; font: 700 11px var(--mono); flex: none; }
  .co { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 10px; border-radius: 6px; text-decoration: none; color: var(--ink-2); font-size: 14px; font-weight: 520; }
  .co:hover { background: var(--hover); color: var(--ink); }
  .co.open { color: var(--ink); font-weight: 620; }
  .co .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .co .badge { margin-left: 0; }
  .mark { border-radius: 5px; display: grid; place-items: center; flex: none; font: 650 10px var(--mono); letter-spacing: 0;
    color: hsl(var(--h) 55% 80%); background: hsl(var(--h) 28% 19%); box-shadow: inset 0 0 0 1px hsl(var(--h) 30% 28%); }
  .sections { display: flex; flex-direction: column; gap: 1px; margin: 2px 0 8px 21px; padding-left: 10px; border-left: 1px solid var(--line); }
  .nav.sub { min-height: 34px; font-size: 13.5px; }
  .nav.sub :global(svg.ic) { width: 17px; height: 17px; }
  .top-nm { flex: 1; min-width: 0; font-weight: 640; letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .top .logo { margin-left: 6px; }
  @media (max-width: 820px) { .main:not(.has-tabs) { padding-bottom: 24px; } }
</style>
