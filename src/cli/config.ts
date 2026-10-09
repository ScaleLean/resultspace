// Where `rs` finds its server and keys. One key per company, each in its own 0600 file; `rs` stores the
// path of a key file and never the key.
//
//   server_url = "http://127.0.0.1:4390"
//   default_company = "acme"
//   [companies.acme]
//   key_file = "/home/me/.config/resultspace/profiles/acme/acme.key"
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export class CliError extends Error {
  readonly code: number;
  readonly kind: string;
  constructor(code: number, kind: string, message: string) {
    super(message);
    this.code = code;
    this.kind = kind;
  }
}
export const usage = (m: string) => new CliError(2, "usage", m);
export const authError = (m: string) => new CliError(3, "auth", m);

export type Config = { path: string; profile: string; server_url: string; default_company: string | null; companies: Record<string, { key_file: string }> };

/** The small part of TOML this file uses: `key = "string"` lines and `[a.b]` table headers. */
export function parseToml(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = { "": {} };
  let table = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const head = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (head?.[1]) { table = head[1]; out[table] ??= {}; continue; }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(line);
    if (kv?.[1] !== undefined && kv[2] !== undefined) (out[table] ??= {})[kv[1]] = kv[2].replace(/\\(.)/g, "$1");
  }
  return out;
}

export function profileName(flag?: string): string {
  if (flag) return flag;
  if (process.env.RS_PROFILE) return process.env.RS_PROFILE;
  const home = process.env.HERMES_HOME;
  return home && basename(dirname(home)) === "profiles" ? basename(home) : "default";
}

export function configPath(profile: string): string {
  if (process.env.RS_CONFIG) return process.env.RS_CONFIG;
  const base = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "resultspace");
  const own = join(base, "profiles", profile, "cli.toml");
  return existsSync(own) ? own : join(base, "cli.toml");
}

export function loadConfig(profileFlag?: string): Config {
  const profile = profileName(profileFlag);
  const path = configPath(profile);
  if (!existsSync(path)) throw authError(`not set up: no config at ${path}`);
  const t = parseToml(readFileSync(path, "utf8"));
  const top = t[""] ?? {};
  if (!top.server_url) throw authError(`${path}: server_url is missing`);
  const companies: Config["companies"] = {};
  for (const [table, v] of Object.entries(t)) {
    const slug = /^companies\.(.+)$/.exec(table)?.[1];
    if (slug && v.key_file) companies[slug] = { key_file: v.key_file };
  }
  if (!Object.keys(companies).length) throw authError(`${path}: no [companies.<slug>] key_file entries. This profile has not been moved to per-company keys yet`);
  return { path, profile, server_url: top.server_url.replace(/\/+$/, ""), default_company: top.default_company ?? null, companies };
}

/** The key for a company, read from its file. The file must be private (0600). */
export function readKey(cfg: Config, slug: string): string {
  const entry = cfg.companies[slug];
  if (!entry) throw new CliError(4, "forbidden", `${slug}: not one of this profile's companies (${Object.keys(cfg.companies).join(", ")})`);
  if (!existsSync(entry.key_file)) throw authError(`key file missing: ${entry.key_file}`);
  if (statSync(entry.key_file).mode & 0o077) throw authError(`key file must be private (chmod 600): ${entry.key_file}`);
  const key = readFileSync(entry.key_file, "utf8").trim();
  if (!key) throw authError(`key file is empty: ${entry.key_file}`);
  return key;
}

export function pickCompany(cfg: Config, flag?: string): string {
  const slugs = Object.keys(cfg.companies);
  const slug = flag ?? cfg.default_company ?? (slugs.length === 1 ? slugs[0] : undefined);
  if (!slug) throw usage(`say which company with --company (one of ${slugs.join(", ")})`);
  if (!cfg.companies[slug]) throw new CliError(4, "forbidden", `${slug}: not one of this profile's companies (${slugs.join(", ")})`);
  return slug;
}
