<!-- The icon for a Journal type (outcome, action, session, note) or a record kind (task, project, knowledge...). -->
<script lang="ts">
  let { type, size = 30, bare = false }: { type: string; size?: number; bare?: boolean } = $props();
  const P: Record<string, [string, string]> = {
    outcome: ["M5 12.5l4.5 4.5L19 7.5", "green"],
    note: ["M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4", "blue"],
    project: ["M3 7h7l2 2h9v10H3z", "ink"],
    knowledge: ["M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z M20 5h-7 M20 5v13h-7", "ink"],
    flag: ["M5 21V4 M5 4h11l-2 4 2 4H5", "red"],
    briefing: ["M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z", "violet"],
    source: ["M10 14l4-4 M8 16a3 3 0 0 1 0-4l3-3 M16 8a3 3 0 0 1 0 4l-3 3", "ink"],
    decision: ["M12 3v18 M5 8l7-5 7 5 M5 8l-2 6h6z M19 8l-2 6h6z", "ink"],
  };
  const ALIAS: Record<string, string> = {
    entry: "note",
    issue: "flag",
    artifact: "source",
    company: "project",
    learning: "knowledge",
    fact: "knowledge",
  };
  const [d, tone] = $derived(P[type] ?? P[ALIAS[type] ?? ""] ?? ["M5 5h14v14H5z", "faint"]);
</script>

<span class="ti {tone}" class:bare style="width:{size}px;height:{size}px" aria-hidden="true">
  <svg viewBox="0 0 24 24" width={Math.round(size * (bare ? 0.8 : 0.56))} height={Math.round(size * (bare ? 0.8 : 0.56))}><path {d} /></svg>
</span>

<style>
  .ti {
    display: inline-grid;
    place-items: center;
    border-radius: 6px;
    flex: none;
  }
  .ti.bare {
    background: transparent !important;
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .green {
    color: var(--green);
    background: var(--green-bg);
  }
  .amber {
    color: var(--amber);
    background: var(--amber-bg);
  }
  .blue {
    color: var(--blue);
    background: var(--blue-bg);
  }
  .red {
    color: var(--red);
    background: var(--red-bg);
  }
  .violet {
    color: var(--violet);
    background: var(--violet-bg);
  }
  .faint {
    color: var(--dim);
    background: var(--hover);
  }
  .ink {
    color: var(--ink-2);
    background: var(--hover);
  }
</style>
