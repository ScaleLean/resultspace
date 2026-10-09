// A tiny markdown -> HTML renderer for skill bodies: headings, paragraphs, lists, bold, inline code, fenced code.
// Every character of the source is HTML-escaped before any tag is added, so the output is safe to put in {@html}.
//   md("# Hi\n\n- a **b** `c`") -> "<h1>Hi</h1>\n<ul><li>a <strong>b</strong> <code>c</code></li></ul>"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

export function md(src: string): string {
  const out: string[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [], list: { tag: "ul" | "ol"; items: string[] } | null = null, code: string[] | null = null;
  const flush = () => {
    if (para.length) { out.push(`<p>${para.map(inline).join(" ")}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; }
  };
  for (const line of lines) {
    if (code) { if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flush(); code = []; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`); continue; }
    const li = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const tag = li[1] ? "ol" : "ul";
      if (para.length || (list && list.tag !== tag)) flush();
      (list ??= { tag, items: [] }).items.push(li[2]!);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (list) flush();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}

/** Split a SKILL.md file into its front matter (key: value lines) and the body. */
export function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const l of m[1]!.split("\n")) { const i = l.indexOf(":"); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return { meta, body: text.slice(m[0].length) };
}
