// Display helpers (safe on server and in the browser).
//   ago("2026-10-06T10:00:00Z") -> "3h ago"      when(iso) -> "Oct 6, 10:00"
//   money(12.5) -> "$12.50"  money(0.0312) -> "$0.031"      words("needs_permission") -> "needs permission"
type Iso = string | null | undefined;

export function ago(iso: Iso): string {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function when(iso: Iso): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false });
}

export function money(usd: number | null | undefined): string {
  const n = Number(usd ?? 0);
  const small = n !== 0 && Math.abs(n) < 1;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: small ? 3 : 2 });
}

export const words = (status: string | null | undefined): string => String(status ?? "").replace(/[_-]+/g, " ").trim();

/** Clock time in 24h: "14:05". */
export function clock(iso: Iso): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "Today", "Yesterday", "Mon 5 Oct", or with a year when it is not this year. */
export function dayLabel(iso: Iso): string {
  if (!iso) return "";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

/** Rows grouped by day, newest day first, keeping the rows' own order. */
export function byDay<T>(rows: T[], at: (r: T) => string | null | undefined): { day: string; rows: T[] }[] {
  const out: { day: string; rows: T[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(at(r));
    const last = out.at(-1);
    if (last && last.day === day) last.rows.push(r); else out.push({ day, rows: [r] });
  }
  return out;
}

export type Actor = { name: string; short: string; initials: string; hue: number; kind: "agent" | "person" | "curator" | "system" };

const titleCase = (s: string) => s.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/** Who an actor string is, for people: "hermes:acme" in Acme is "Agent". */
export function actor(raw: string | null | undefined, companySlug?: string): Actor {
  const name = String(raw ?? "").trim() || "unknown";
  if (name === "curator") return { name, short: "Curator", initials: "✦", hue: 258, kind: "curator" };
  if (/^(import|payload-importer|system|adapter:.*|feed:.*)$/.test(name)) {
    const short = name.startsWith("adapter:") || name.startsWith("feed:") ? titleCase(name.split(":")[1] ?? name) : "Import";
    return { name, short, initials: short.slice(0, 1).toUpperCase(), hue: 40, kind: "system" };
  }
  const m = /^([a-z]+):(.+)$/.exec(name);
  if (m) {
    const who = m[2]!;
    const short = who === companySlug ? "Agent" : `${titleCase(who)} agent`;
    const initials = who === companySlug ? "A" : titleCase(who).split(" ").map((w) => w[0]).join("").slice(0, 2);
    return { name, short, initials, hue: hash(who) % 360, kind: "agent" };
  }
  return { name, short: titleCase(name), initials: titleCase(name).slice(0, 1), hue: hash(name) % 360, kind: "person" };
}

export type Split = { context: string; head: string; rest: string };

/**
 * Agent text as context · headline · rest. "Ads 1234567890: removed 12 campaigns...; readback ok. Total 28."
 * -> context "Ads 1234567890", head "Removed 12 campaigns...", rest "readback ok. Total 28."
 * Nothing is dropped: context + head + rest is the whole text.
 */
export function split(text: string | null | undefined, max = 120): Split {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  let context = "";
  const c = /^([^:.;]{2,42}):\s+(\S[\s\S]*)$/.exec(s);
  if (c && !/^(https?|note|learned|decision)$/i.test(c[1]!.trim())) { context = c[1]!.trim(); s = c[2]!; }
  if (s.length <= max) return { context, head: cap(s), rest: "" };
  const ends = [...s.matchAll(/[.;!?](?=\s)|\s[—–-]\s/g)].map((m) => (m.index ?? 0) + 1).filter((i) => i >= 24 && i <= max + 30);
  const cut = ends[0] ?? (s.lastIndexOf(" ", max) > 40 ? s.lastIndexOf(" ", max) : max);
  return { context, head: cap(s.slice(0, cut).trim().replace(/[;,]$/, "")), rest: s.slice(cut).replace(/^[\s;,.—–-]+/, "").trim() };
}
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A long path like /home/me/agents/x/y/FIX.md -> …/y/FIX.md */
export const shortPath = (p: string) => (p.split("/").length > 3 ? `…/${p.split("/").slice(-2).join("/")}` : p);
