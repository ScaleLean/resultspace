// Plain-text output for people. With --json, `rs` prints one JSON document instead.
type Row = Record<string, unknown>;

const cell = (v: unknown, max = 70): string => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  const one = s.replace(/\s+/g, " ");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

export function table(rows: Row[], columns: string[], empty = "(none)"): string {
  if (!rows.length) return empty;
  const width = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (cells: string[]) => cells.map((s, i) => (i === cells.length - 1 ? s : s.padEnd(width[i]!))).join("  ").trimEnd();
  return [line(columns.map((c) => c.toUpperCase())), ...rows.map((r) => line(columns.map((c) => cell(r[c]))))].join("\n");
}

export function pairs(o: Row, max = 100): string {
  const keys = Object.keys(o);
  const w = Math.max(0, ...keys.map((k) => k.length));
  return keys.map((k) => `${k.padEnd(w)}  ${cell(o[k], max)}`).join("\n");
}

/** A record's display line when the kind's title field is not known here. */
export function titleOf(body: Row, key: string): string {
  for (const f of ["title", "name", "wording", "headline", "metric", "label", "text"]) {
    const v = body[f];
    if (typeof v === "string" && v.trim()) return v;
  }
  return key;
}
