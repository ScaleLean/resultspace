<!-- One thing that waits for a person, acted on in place: a request (Approve / Decline), an assignment that waits for
     an answer (reply), or a flag (Fixed / Dismiss). The forms post to ?/decide, ?/answer, ?/flag with `slug` and
     `key` (web/lib/server/inbox.ts). `company`: show which company it is from (the home page). -->
<script lang="ts">
  import { enhance } from "$app/forms";
  import Text from "./Text.svelte";
  import { ago, words } from "./fmt.ts";
  type Line = { key: string; title: string; at?: string; by?: string; why?: unknown; type?: unknown; input?: unknown; owner?: string | null; detail?: unknown; about?: { key: string; title: string } | null };
  let { kind, item, slug, company = "", draft = "", onbusy }: {
    kind: "request" | "answer" | "flag"; item: Line; slug: string; company?: string; draft?: string; onbusy?: (busy: boolean) => void;
  } = $props();

  let busy = $state(false);
  const txt = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const short = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 60 ? `${s.slice(0, 57)}…` : s; };
  // A request's proposed change in plain words, e.g. "Set status to done on TSK-0007".
  function change(type: unknown, input: unknown): string {
    const op = txt(type); const i = obj(input); const ref = typeof i.ref === "string" ? i.ref : "";
    if (op === "record.patch" && ref) {
      const set = Object.entries(obj(i.set)).map(([k, v]) => (v === null ? `remove ${words(k)}` : `set ${words(k)} to ${short(v)}`));
      if (set.length) { const s = `${set.join(", ")} on ${ref}`; return s[0]!.toUpperCase() + s.slice(1); }
    }
    if (op === "record.archive" && ref) return `Archive ${ref}`;
    const s = words(op.replace(/\./g, " ")) + (ref ? ` on ${ref}` : "");
    return s ? s[0]!.toUpperCase() + s.slice(1) : "";
  }
  const source = $derived(kind === "request" ? (item.by === "curator" ? "Curator" : "Request") : kind === "answer" ? "Agent asks" : item.type ? words(txt(item.type)) : "Flag");
  const href = $derived(kind === "answer" ? `/c/${slug}/assignments/${item.key}` : `/c/${slug}/r/${item.key}`);
  const why = $derived(kind === "answer" ? txt(item.detail) : txt(item.why));
  const saving = () => {
    busy = true; onbusy?.(true);
    return async ({ update }: { update: () => Promise<void> }) => { try { await update(); } finally { busy = false; onbusy?.(false); } };
  };
</script>

<form method="POST" action="?/{kind === 'request' ? 'decide' : kind}" class="need {kind}" use:enhance={saving}>
  <input type="hidden" name="slug" value={slug} />
  <input type="hidden" name="key" value={item.key} />
  <div class="src">
    {#if kind === "request"}<span aria-hidden="true">✦</span>{:else if kind === "answer"}<span aria-hidden="true">?</span>{:else}<span aria-hidden="true">!</span>{/if}
    <span>{source}</span>{#if company}<span class="sep">·</span><span>{company}</span>{/if}
    {#if item.at}<span class="at">{ago(item.at)}</span>{/if}
  </div>
  <a class="title" {href}>{item.title}</a>
  {#if why}<p class="why clamp-3"><Text text={why} {slug} /></p>{/if}
  {#if kind === "request" && item.type}<p class="change"><span>If you approve</span> <Text text={change(item.type, item.input)} {slug} /></p>{/if}
  {#if kind === "request"}
    <div class="acts">
      <button class="btn approve" name="approve" value="yes" disabled={busy}>Approve</button>
      <button class="btn ghost" name="approve" value="no" disabled={busy}>Decline</button>
    </div>
  {:else if kind === "answer"}
    <div class="reply">
      <input name="answer" aria-label="Your answer" placeholder="Reply to the agent…" maxlength="1000" required value={draft} autocomplete="off" />
      <button class="btn send" disabled={busy}>Send</button>
    </div>
  {:else}
    <div class="acts">
      <button class="btn" name="status" value="fixed" disabled={busy}>Fixed</button>
      <button class="btn ghost" name="status" value="dismissed" disabled={busy}>Dismiss</button>
    </div>
  {/if}
</form>

<style>
  .need { display: flex; flex-direction: column; gap: 6px; padding: 16px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
  .src { display: flex; align-items: center; gap: 7px; font: 500 11px var(--mono); letter-spacing: .04em; text-transform: uppercase; color: var(--violet); }
  .answer .src { color: var(--amber); } .flag .src { color: var(--red); }
  .src .sep { opacity: .5; }
  .src .at { margin-left: auto; color: var(--faint); text-transform: none; letter-spacing: 0; }
  .title { font-size: 16px; font-weight: 620; letter-spacing: -.02em; line-height: 1.35; text-decoration: none; }
  .title:hover { text-decoration: underline; text-decoration-color: var(--line-2); }
  .why { margin: 0; color: var(--dim); font-size: 14px; line-height: 1.5; }
  .change { margin: 2px 0 0; padding: 8px 10px; border-left: 2px solid var(--violet); background: var(--violet-bg); font-size: 13.5px; border-radius: 0 4px 4px 0; }
  .change span { color: var(--violet); font: 500 11px var(--mono); text-transform: uppercase; letter-spacing: .04em; margin-right: 6px; }
  .acts { display: flex; gap: 8px; margin-top: 8px; }
  .acts .btn { min-width: 96px; }
  .approve { background: var(--violet); border-color: var(--violet); color: #1b1525; }
  .approve:hover { background: var(--violet); opacity: .9; }
  .reply { display: flex; gap: 8px; margin-top: 8px; }
  .reply input { flex: 1; min-width: 0; }
  .send { background: var(--amber); border-color: var(--amber); color: #241a0b; }
  .send:hover { background: var(--amber); opacity: .9; }
</style>
