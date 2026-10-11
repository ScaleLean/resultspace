#!/usr/bin/env node
// `rs`: the ResultSpace command line for people and agents. A thin client: every command is one or two
// calls to the server's operations. No local copy, no sync.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Rec, Revision, Hit, Link } from "../core/records.ts";
import type { KindDef } from "../core/schema.ts";
import type { JournalItem } from "../operations/views.ts";
import { intFlag, parseArgs, parseFields, type Args } from "./args.ts";
import { call, me } from "./client.ts";
import { CliError, configPath, loadConfig, parseToml, pickCompany, profileName, readKey, usage, type Config } from "./config.ts";
import { pairs, table, titleOf } from "./format.ts";
import { HELP, TOPICS } from "./help.ts";

type Out = { data: unknown; text: string };
type Cmd = (a: Args, cfg: Config, slug: string) => Promise<Out>;

const shape = (r: Rec, slug: string) => ({...r, company_id:slug, title:titleOf(r.body,r.key), status:typeof r.body.status === "string" ? r.body.status : null});
const need = (a: Args, n: number, what: string): string => {
  const w = a.words[n];
  if (!w) throw usage(`missing ${what}`);
  return w;
};
// The old kinds that are Journal entries now: `rs ls note` and `rs new note` keep working.
const OLD_KINDS: Record<string, string> = { note: "note", result: "outcome" };
const kindOf = (name: string): { kind: string; type?: string } =>
  OLD_KINDS[name] ? { kind: "entry", type: OLD_KINDS[name] } : { kind: name };

const commands: Record<string, Cmd> = {
  async project(a, cfg, slug) {
    if (need(a, 0, "context") !== "context") throw usage("use: rs project context KEY");
    const data = await call(cfg, slug, "project.context", {
      ref: need(a, 1, "a project key"),
      ...(intFlag(a, "limit") ? { limit: intFlag(a, "limit") } : {}),
    });
    return { data, text: JSON.stringify(data, null, 2) };
  },
  async curator(a, cfg, slug) {
    const sub = a.words[0] ?? "scan";
    if (!["scan", "review"].includes(sub)) throw usage("use: rs curator scan | review");
    const data = await call(cfg, slug, `curator.${sub}`, {}, sub === "review");
    return { data, text: JSON.stringify(data, null, 2) };
  },
  async legacy(_a, cfg, slug) {
    const records = await call(cfg, slug, "archive.list", {});
    return { data: { records }, text: JSON.stringify(records, null, 2) };
  },
  async ls(a, cfg, slug) {
    const asked = need(a, 0, "a kind: rs ls project");
    const { kind, type } = kindOf(asked);
    const where = { ...(type ? { type } : {}), ...parseFields(a.words.slice(1)) } as Record<string, string>;
    const recs = await call<Rec[]>(cfg, slug, "record.list", {
      kind,
      ...(a.flags.status ? { status: a.flags.status } : {}),
      ...(Object.keys(where).length ? { where } : {}),
      ...(a.bools.has("archived") ? { archived: true } : a.bools.has("all") ? { archived: "all" } : {}),
      limit: intFlag(a, "limit") ?? 200,
    });
    const records = recs.map((r) => shape(r, slug));
    return { data: { company_id: slug, kind: asked, records }, text: table(records, ["key", "title", "status"]) };
  },
  async show(a, cfg, slug) {
    const r = shape(await call<Rec>(cfg, slug, "record.get", { ref: need(a, 0, "a record key: rs show PRJ-0001") }), slug);
    return {
      data: { record: r },
      text: `${pairs({ key: r.key, id: r.id, kind: r.kind, company: slug, rev: r.rev, archived: r.archived })}\n\n${pairs(r.body, 2000)}`,
    };
  },
  async new(a, cfg, slug) {
    const { kind, type } = kindOf(need(a, 0, 'a kind: rs new project title="Launch"'));
    let body = { ...(type ? { type } : {}), ...parseFields(a.words.slice(1)) };
    if (a.flags.body) {
      try {
        body = { ...(type ? { type } : {}), ...(JSON.parse(a.flags.body) as Record<string, unknown>), ...body };
      } catch {
        throw usage("--body needs a JSON object");
      }
    }
    const r = shape(
      await call<Rec>(
        cfg,
        slug,
        "record.create",
        { kind, body, ...(a.flags.result ? { result: a.flags.result } : {}), ...(a.flags.why ? { why: a.flags.why } : {}) },
        true,
      ),
      slug,
    );
    return { data: { key: r.key, id: r.id, record: r }, text: `created ${r.key}  ${r.title}` };
  },
  async set(a, cfg, slug) {
    const ref = need(a, 0, "a record key: rs set PRJ-0001 current_state=Reviewed");
    const set = parseFields(a.words.slice(1));
    if (!Object.keys(set).length && !a.flags.result) throw usage("nothing to set: rs set PRJ-0001 current_state=Reviewed");
    const baseRev = intFlag(a, "base-rev");
    const r = shape(
      await call<Rec>(
        cfg,
        slug,
        "record.patch",
        {
          ref,
          set,
          ...(baseRev ? { base_rev: baseRev } : {}),
          ...(a.flags.result ? { result: a.flags.result } : {}),
          ...(a.flags.why ? { why: a.flags.why } : {}),
        },
        true,
      ),
      slug,
    );
    return { data: { key: r.key, rev: r.rev, record: r }, text: `saved ${r.key} (revision ${r.rev})` };
  },
  async archive(a, cfg, slug) {
    const r = shape(await call<Rec>(cfg, slug, "record.archive", { ref: need(a, 0, "a record key") }, true), slug);
    return { data: { key: r.key, record: r }, text: `archived ${r.key}` };
  },
  async restore(a, cfg, slug) {
    const r = shape(await call<Rec>(cfg, slug, "record.restore", { ref: need(a, 0, "a record key") }, true), slug);
    return { data: { key: r.key, record: r }, text: `restored ${r.key}` };
  },
  async search(a, cfg, slug) {
    const hits = await call<Hit[]>(cfg, slug, "record.search", {
      q: need(a, 0, "search words"),
      ...(a.flags.kind ? { kind: a.flags.kind } : {}),
      limit: intFlag(a, "limit") ?? 20,
    });
    return {
      data: { query: a.words[0], hits },
      text: hits.length ? hits.map((h) => `${h.key}  ${h.title}\n    ${h.snippet}`).join("\n") : "Not on record.",
    };
  },
  async history(a, cfg, slug) {
    const revisions = await call<Revision[]>(cfg, slug, "record.history", { ref: need(a, 0, "a record key") });
    return {
      data: { revisions },
      text: table(
        revisions.map((v) => ({ rev: v.rev, at: v.at, by: v.actor, op: v.op, changed: v.changed.join(", "), why: v.why })),
        ["rev", "at", "by", "op", "changed", "why"],
      ),
    };
  },
  async context(a, cfg, slug) {
    const c = await call<{ record: Rec; links: { out: Link[]; in: Link[] }; history: unknown[] }>(cfg, slug, "record.context", {
      ref: need(a, 0, "a record key"),
    });
    const link = (l: Link) => `  ${l.label}: ${l.key}  ${l.title}`;
    return {
      data: { ...c, record: shape(c.record, slug) },
      text: [
        `${c.record.key}  ${titleOf(c.record.body, c.record.key)}`,
        pairs(c.record.body, 2000),
        "Points at:",
        ...c.links.out.map(link),
        "Pointed at by:",
        ...c.links.in.map(link),
      ].join("\n"),
    };
  },
  async activity(a, cfg, slug) {
    const items = await call<Record<string, unknown>[]>(cfg, slug, "activity.list", {
      ...(a.flags.since ? { since: a.flags.since } : {}),
      limit: intFlag(a, "limit") ?? 100,
    });
    return { data: { items }, text: table(items, ["at", "actor", "key", "op", "title"]) };
  },
  async journal(a, cfg, slug) {
    const items = await call<JournalItem[]>(cfg, slug, "journal.list", {
      ...(a.flags.type ? { type: a.flags.type } : {}),
      ...(a.flags.since ? { since: a.flags.since } : {}),
      ...(a.flags.project ? { project: a.flags.project } : {}),
      limit: intFlag(a, "limit") ?? 50,
    });
    return {
      data: { items },
      text: table(
        items.map((e) => ({ at: e.at.slice(0, 16), type: e.type, by: e.by, project: e.project, entry: e.title })),
        ["at", "type", "by", "project", "entry"],
      ),
    };
  },
  async log(a, cfg, slug) {
    const title = need(a, 0, 'what happened: rs log "Label shipped to the printer"');
    const e = shape(
      await call<Rec>(
        cfg,
        slug,
        "journal.log",
        {
          title,
          ...(a.flags.type ? { type: a.flags.type } : {}),
          ...(a.flags.text ? { detail: a.flags.text } : {}),
          ...(a.flags.source ? { source: a.flags.source } : {}),
          ...(a.flags.about ? { about: a.flags.about } : {}),
          ...(a.flags.project ? { project: a.flags.project } : {}),
        },
        true,
      ),
      slug,
    );
    return { data: { key: e.key, id: e.id, record: e }, text: `logged ${e.key}  ${e.title}` };
  },

  async brief(a, cfg, slug) {
    const b = await call<{ text: string }>(cfg, slug, "brief.get", { ...(intFlag(a, "budget") ? { budget: intFlag(a, "budget") } : {}) });
    return { data: b, text: b.text };
  },

  async note(a, cfg, slug) {
    if (need(a, 0, "add") !== "add") throw usage('use: rs note add "title" --text "..."');
    const e = shape(
      await call<Rec>(
        cfg,
        slug,
        "journal.log",
        {
          type: "note",
          title: need(a, 1, "a title"),
          ...(a.flags.text ? { detail: a.flags.text } : {}),
          ...(a.flags.project ? { project: a.flags.project } : {}),
        },
        true,
      ),
      slug,
    );
    if (a.flags.result) await call(cfg, slug, "journal.log", { title: a.flags.result, about: e.key }, true);
    return { data: { key: e.key, id: e.id, record: e }, text: `noted ${e.key}  ${e.title}` };
  },

  async knowledge(a, cfg, slug) {
    const collection = a.words[0];
    if (collection === "health") {
      const all = await call<Rec[]>(cfg, slug, "record.list", { kind: "knowledge", limit: 1000 });
      const n = all.length;
      const pct = (k: number) => (n ? Math.round((100 * k) / n) : 0);
      const health = {
        pages: n,
        sourced_pct: pct(
          all.filter((r) => (Array.isArray(r.body.source_ids) ? r.body.source_ids.length : r.body.source || r.body.url)).length,
        ),
      };
      return { data: health, text: `Knowledge: ${n} pages, ${health.sourced_pct}% sourced` };
    }
    if (a.flags.search) {
      const hits = await call<Hit[]>(cfg, slug, "record.search", {
        q: a.flags.search,
        kind: "knowledge",
        limit: intFlag(a, "limit") ?? 20,
      });
      return {
        data: { hits },
        text: hits.length ? hits.map((h) => `${h.key}  ${h.title}\n    ${h.snippet}`).join("\n") : "Not on record.",
      };
    }
    const recs = await call<Rec[]>(cfg, slug, "record.list", {
      kind: "knowledge",
      ...(collection ? { where: { collection } } : {}),
      limit: intFlag(a, "limit") ?? 200,
    });
    const records = recs.map((r) => shape(r, slug));
    return {
      data: { company_id: slug, kind: "knowledge", records },
      text: table(
        records.map((r) => ({ key: r.key, collection: r.body.collection, title: r.title })),
        ["key", "collection", "title"],
      ),
    };
  },

  async kinds(a, cfg, slug) {
    const kinds = await call<KindDef[]>(cfg, slug, "kind.list");
    return {
      data: { kinds },
      text: table(
        kinds.map((k) => ({ kind: k.kind, prefix: k.prefix, title: k.title_field, statuses: k.statuses?.join(", ") ?? "" })),
        ["kind", "prefix", "title", "statuses"],
      ),
    };
  },
  async agents(a, cfg, slug) {
    const sub = a.words[0] ?? "ls";
    if (sub === "ls") {
      const agents = await call<Record<string, unknown>[]>(cfg, slug, "agent.list");
      return { data: { agents }, text: table(agents, ["name", "role", "active", "last_seen"]) };
    }
    const name = need(a, 1, "an agent name");
    if (sub === "add") {
      await call(cfg, slug, "agent.add", { name, ...(a.flags.role ? { role: a.flags.role } : {}) }, true);
      return { data: { agent: name }, text: `added ${name}` };
    }
    if (sub === "revoke") {
      await call(cfg, slug, "agent.revoke", { name }, true);
      return { data: { agent: name }, text: `revoked every key of ${name}` };
    }
    if (sub === "key") {
      if (!a.flags.out) throw usage("say where to write the key: rs agents key NAME --out FILE (the key is never printed)");
      const k = await call<{ key: string }>(cfg, slug, "agent.key", { name });
      writeFileSync(a.flags.out, `${k.key}\n`, { mode: 0o600, flag: "wx" });
      return { data: { agent: name, key_file: a.flags.out }, text: `key for ${name} written to ${a.flags.out}` };
    }
    throw usage(`unknown: rs agents ${sub}. Use ls | add | key | revoke`);
  },
  async blob(a, cfg, slug) {
    if (need(a, 0, "get") !== "get" || !a.flags.out) throw usage("use: rs blob get SHA256 --out FILE");
    const b = await call<{ sha256: string; size: number; b64: string }>(cfg, slug, "blob.get", { sha256: need(a, 1, "a sha256") });
    writeFileSync(a.flags.out, Buffer.from(b.b64, "base64"));
    return { data: { sha256: b.sha256, size: b.size, out: a.flags.out }, text: `wrote ${b.size} bytes to ${a.flags.out}` };
  },
  async status(_a, cfg, slug) {
    const c = await call<{ kinds: { kind: string; live: number; archived: number }[]; last_seq: number }>(cfg, slug, "company.get");
    return {
      data: { profile: cfg.profile, server: cfg.server_url, company: slug, ...c },
      text: `profile  ${cfg.profile}\nserver   ${cfg.server_url}\ncompany  ${slug}\n\n${table(c.kinds, ["kind", "live", "archived"])}`,
    };
  },
};
const usageNow = (m: string): never => {
  throw usage(m);
};
const ALIAS: Record<string, string> = { list: "ls", get: "show", create: "new", edit: "set", ask: "search", results: "journal" };

// Commands that speak for the whole profile, not one company.
async function whoami(cfg: Config, only?: string): Promise<Out> {
  const slugs = only ? [pickCompany(cfg, only)] : Object.keys(cfg.companies);
  const all = await Promise.all(slugs.map((s) => me(cfg, s)));
  const companies = all.map((m) => ({ id: m.company.slug, slug: m.company.slug, name: m.company.name, role: m.actor.role, modules: [] }));
  const actor = { kind: all[0]!.actor.kind, name: all[0]!.actor.name };
  return {
    data: { actor, auth: { method: "agent_key" }, companies, profile: cfg.profile, server: cfg.server_url, version: all[0]!.version },
    text: `actor    ${actor.name}\nkind     ${actor.kind}\nprofile  ${cfg.profile}\nserver   ${cfg.server_url}\n\n${table(companies, ["slug", "name", "role"])}`,
  };
}

/** Write (or extend) this profile's cli.toml: rs init --server URL --company SLUG --key-file FILE */
function init(a: Args): Out {
  const slug = a.flags.company;
  const keyFile = a.flags["key-file"];
  if (!slug || !keyFile)
    throw usage("use: rs init --server http://127.0.0.1:4390 --company acme --key-file ~/.config/resultspace/keys/acme.key");
  const path = configPath(profileName(a.flags.profile));
  const cur = existsSync(path) ? parseToml(readFileSync(path, "utf8")) : {};
  const top = cur[""] ?? {};
  const server = a.flags.server ?? top.server_url;
  if (!server) throw usage("--server is needed the first time");
  const companies: Record<string, string> = {};
  for (const [t, v] of Object.entries(cur)) {
    const m = /^companies\.(.+)$/.exec(t);
    if (m?.[1] && v.key_file) companies[m[1]] = v.key_file;
  }
  companies[slug] = keyFile.replace(/^~(?=\/)/, homedir());
  if (!existsSync(companies[slug]))
    throw usage(`no key file at ${companies[slug]} (make one in Admin, or with: node src/admin.ts agent key ${slug} NAME --out FILE)`);
  const lines = [
    `server_url = "${server.replace(/\/+$/, "")}"`,
    `default_company = "${a.bools.has("default") || !top.default_company ? slug : top.default_company}"`,
  ];
  for (const [c, f] of Object.entries(companies)) lines.push(`[companies.${c}]`, `key_file = "${f}"`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  return {
    data: { path, server, companies: Object.keys(companies) },
    text: `wrote ${path}: ${server}, companies ${Object.keys(companies).join(", ")}. Check it: rs doctor`,
  };
}

async function doctor(profile?: string): Promise<Out> {
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const add = (check: string, ok: boolean, detail = "") => checks.push({ check, ok, detail });
  let cfg: Config | undefined;
  try {
    cfg = loadConfig(profile);
    add("config", true, cfg.path);
  } catch (e) {
    add("config", false, e instanceof Error ? e.message : String(e));
  }
  if (cfg) {
    try {
      const r = await fetch(`${cfg.server_url}/health`, { signal: AbortSignal.timeout(10_000) });
      add("server", r.ok, `${cfg.server_url} answered ${r.status}`);
    } catch (e) {
      add("server", false, `cannot reach ${cfg.server_url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const slug of Object.keys(cfg.companies)) {
      try {
        readKey(cfg, slug);
        const m = await me(cfg, slug);
        add(`key ${slug}`, true, `${m.actor.name} (${m.actor.role})`);
      } catch (e) {
        add(`key ${slug}`, false, e instanceof Error ? e.message : String(e));
      }
    }
    if (cfg.default_company && !cfg.companies[cfg.default_company]) add("default company", false, `${cfg.default_company} has no key`);
  }
  const ok = checks.every((c) => c.ok);
  if (!ok) process.exitCode = 1;
  return {
    data: { ok, checks },
    text: `${table(
      checks.map((c) => ({ check: c.check, result: c.ok ? "ok" : "FAIL", detail: c.detail })),
      ["check", "result", "detail"],
    )}\n\n${ok ? "All good." : "Something needs fixing (see FAIL)."}`,
  };
}

async function main(argv: string[]): Promise<{ command: string; out: Out }> {
  const a = parseArgs(argv);
  const name = a.words.shift() ?? "help";
  const command = ALIAS[name] ?? name;
  if (command === "help" || a.bools.has("help")) {
    const topic = command === "help" ? a.words[0] : command;
    return { command: "help", out: { data: { topics: Object.keys(TOPICS) }, text: (topic && TOPICS[topic]) || HELP } };
  }
  if (command === "doctor") return { command, out: await doctor(a.flags.profile) };
  if (command === "init") return { command, out: init(a) };
  const cfg = loadConfig(a.flags.profile);
  if (command === "whoami") return { command, out: await whoami(cfg, a.flags.company) };
  if (command === "companies") {
    const w = await whoami(cfg);
    const companies = (w.data as { companies: Record<string, unknown>[] }).companies;
    return { command, out: { data: { companies }, text: table(companies, ["slug", "name", "role"]) } };
  }
  const cmd = commands[command];
  if (!cmd) throw usage(`unknown command: rs ${name}. See rs help`);
  if (a.bools.has("all-companies")) {
    const parts = await Promise.all(
      Object.keys(cfg.companies).map(async (slug) => ({ slug, out: await cmd({ ...a, words: [...a.words] }, cfg, slug) })),
    );
    return {
      command,
      out: {
        data: { companies: parts.map((p) => ({ company: p.slug, ...(p.out.data as object) })) },
        text: parts.map((p) => `== ${p.slug}\n${p.out.text}`).join("\n\n"),
      },
    };
  }
  return { command, out: await cmd(a, cfg, pickCompany(cfg, a.flags.company)) };
}

const argv = process.argv.slice(2);
const json = argv.includes("--json");
try {
  const { command, out } = await main(argv);
  console.log(
    json ? JSON.stringify({ ok: true, command, data: out.data, schema_version: 5, warnings: [] }, null, 2) : out.text,
  );
} catch (e) {
  const err = e instanceof CliError ? e : new CliError(1, "error", e instanceof Error ? e.message : String(e));
  if (json) console.log(JSON.stringify({ ok: false, error: { code: err.code, kind: err.kind, message: err.message } }, null, 2));
  else console.error(`rs: ${err.message}`);
  process.exitCode = err.code;
}
