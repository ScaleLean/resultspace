// The database the core talks to. Node's built-in SQLite today; the same four calls can be backed by
// another SQLite host later (a Cloudflare Durable Object, for example) without the core noticing.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type Value = SQLInputValue;

export interface Db {
  one<T>(sql: string, ...params: Value[]): T | undefined;
  all<T>(sql: string, ...params: Value[]): T[];
  run(sql: string, ...params: Value[]): void;
  /** Several statements at once, no parameters (schema and upgrades). */
  exec(sql: string): void;
  /** All of `fn` is stored, or none of it. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T;
  close(): void;
}

/** A SQLite file opened with Node's built-in driver. */
export class NodeDb implements Db {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(file: string, o: { readOnly?: boolean } = {}) {
    this.db = new DatabaseSync(file, { readOnly: o.readOnly ?? false });
    if (!o.readOnly) this.db.exec("pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on; pragma busy_timeout = 5000;");
  }

  one<T>(sql: string, ...params: Value[]): T | undefined { return this.db.prepare(sql).get(...params) as T | undefined; }
  all<T>(sql: string, ...params: Value[]): T[] { return this.db.prepare(sql).all(...params) as T[]; }
  run(sql: string, ...params: Value[]): void { this.db.prepare(sql).run(...params); }
  exec(sql: string): void { this.db.exec(sql); }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec("begin immediate");
    this.depth = 1;
    try {
      const out = fn();
      this.db.exec("commit");
      return out;
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  close(): void { this.db.close(); }
}
