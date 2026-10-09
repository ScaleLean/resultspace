// Command-line parsing for `rs`: flags may come anywhere, `k=v` and `k:=json` set fields.
import { usage } from "./config.ts";

const VALUE_FLAGS = new Set(["company", "profile", "result", "status", "limit", "kind", "since", "detail", "amount", "unit", "wo", "project", "text",
  "body", "out", "budget", "search", "now", "target", "role", "why", "base-rev", "prefix", "statuses", "about", "progress", "owner", "brief", "title-field", "type", "server", "key-file",
  "assignment", "asg", "answer", "note"]);
const BOOL_FLAGS = new Set(["json", "online", "all-companies", "archived", "all", "ai", "host", "rebootstrap", "help", "version", "shared", "default", "disputed"]);
const SHORT: Record<string, string> = { C: "company", h: "help" };

export type Args = { words: string[]; flags: Record<string, string>; bools: Set<string> };

export function parseArgs(argv: string[]): Args {
  const words: string[] = []; const flags: Record<string, string> = {}; const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") { words.push(...argv.slice(i + 1)); break; }
    const long = /^--([a-z][a-z-]*)(?:=(.*))?$/s.exec(a);
    const name = long?.[1] ?? (/^-([A-Za-z])$/.exec(a)?.[1] !== undefined ? SHORT[a.slice(1)] : undefined);
    if (!name) {
      if (/^-[A-Za-z]/.test(a) && !/^-\d/.test(a)) throw usage(`unknown flag ${a}`);
      words.push(a);
      continue;
    }
    if (BOOL_FLAGS.has(name)) { bools.add(name); continue; }
    if (!VALUE_FLAGS.has(name)) throw usage(`unknown flag --${name}`);
    const value = long?.[2] ?? argv[++i];
    if (value === undefined) throw usage(`--${name} needs a value`);
    flags[name] = value;
  }
  return { words, flags, bools };
}

/** `title="Call" priority=high budget:=500 note:=null` -> fields. `:=` takes JSON; `:=null` removes a field on `rs set`. */
export function parseFields(words: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const w of words) {
    const m = /^([A-Za-z_][A-Za-z0-9_.]*?)(:?=)(.*)$/s.exec(w);
    if (!m?.[1] || m[3] === undefined) throw usage(`expected field=value, got: ${w}`);
    if (m[2] === "=") out[m[1]] = m[3];
    else {
      try { out[m[1]] = JSON.parse(m[3]) as unknown; } catch { throw usage(`${m[1]}:= needs JSON, got: ${m[3]}`); }
    }
  }
  return out;
}

export function intFlag(a: Args, name: string): number | undefined {
  const v = a.flags[name];
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw usage(`--${name} needs a whole number`);
  return Number(v);
}
