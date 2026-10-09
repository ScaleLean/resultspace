// One company = one SQLite file. A Company object can only ever read and write its own file.
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { NodeDb, type Db, type Value } from "./db.ts";
import { invalid, notFound, RsError } from "./errors.ts";
import { BUILTIN_KINDS, DDL, SCHEMA_VERSION, UPGRADES } from "./schema.ts";

export const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function companyFile(dir: string, slug: string): string {
  if (!SLUG.test(slug)) throw invalid(`bad company slug: ${slug}`);
  return join(dir, `${slug}.sqlite`);
}

export class Company {
  readonly slug: string;
  readonly name: string;
  private readonly db: Db;

  private constructor(slug: string, name: string, db: Db) {
    this.slug = slug;
    this.name = name;
    this.db = db;
  }

  /** Open the company's file. Pass `create` to make it when it does not exist yet. */
  static open(dir: string, slug: string, create?: { name: string }): Company {
    const file = companyFile(dir, slug);
    const fresh = !existsSync(file);
    if (fresh && !create) throw notFound(`company ${slug}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const db = new NodeDb(file);
    try {
      const co = Company.attach(db, slug, fresh && create ? create.name : undefined);
      for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
      return co;
    } catch (e) {
      db.close();
      // A file we failed to set up must not be left behind looking like a company.
      if (fresh) for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
      throw e;
    }
  }

  /** Attach to an open database: set it up when `createName` is given, else check it is this company's and current. */
  static attach(db: Db, slug: string, createName?: string): Company {
    if (createName !== undefined) init(db, slug, createName);
    if (!db.one("select 1 from sqlite_master where type = 'table' and name = 'meta'")) throw invalid(`${slug}: not a ResultSpace company file`);
    const meta = new Map(db.all<{ k: string; v: string }>("select k, v from meta").map((r) => [r.k, r.v]));
    // The file says which company it belongs to. A file copied or renamed to another slug is refused.
    if (meta.get("slug") !== slug) throw new RsError("forbidden", `this file belongs to ${meta.get("slug") ?? "nobody"}, not ${slug}`);
    let version = Number(meta.get("schema_version"));
    if (version > SCHEMA_VERSION || !Number.isInteger(version)) throw invalid(`${slug}: unknown schema version ${meta.get("schema_version")}`);
    while (version < SCHEMA_VERSION) {
      const step = UPGRADES[version + 1];
      if (!step) throw invalid(`${slug}: no upgrade from schema ${version}`);
      const next = version + 1;
      db.tx(() => {
        if (typeof step === "string") db.exec(step); else step(db);
        db.run("update meta set v = ? where k = 'schema_version'", String(next));
      });
      version = next;
    }
    return new Company(slug, meta.get("name") ?? slug, db);
  }

  one<T>(sql: string, ...params: Value[]): T | undefined { return this.db.one<T>(sql, ...params); }
  all<T>(sql: string, ...params: Value[]): T[] { return this.db.all<T>(sql, ...params); }
  run(sql: string, ...params: Value[]): void { this.db.run(sql, ...params); }
  /** All of `fn` is stored, or none of it. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T { return this.db.tx(fn); }
  close(): void { this.db.close(); }
}

function init(db: Db, slug: string, name: string): void {
  db.tx(() => {
    db.exec(DDL);
    const meta: [string, string][] = [["slug", slug], ["name", name], ["schema_version", String(SCHEMA_VERSION)], ["created_at", new Date().toISOString()]];
    for (const [k, v] of meta) db.run("insert into meta (k, v) values (?, ?)", k, v);
    for (const k of BUILTIN_KINDS)
      db.run("insert into kinds (kind, prefix, title_field, statuses, refs) values (?, ?, ?, ?, ?)", k.kind, k.prefix, k.title_field, k.statuses ? JSON.stringify(k.statuses) : null, JSON.stringify(k.refs));
  });
}
