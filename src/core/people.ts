// People and their sign-in, in the system file (_system.sqlite). The system file holds nothing of any
// company: only who may sign in to this server. A signed-in person is an admin of every company on it.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Actor } from "./agents.ts";
import { invalid } from "./errors.ts";

export const SESSION_COOKIE = "rs_session";
export const SESSION_DAYS = 30;
export const RESET_MINUTES = 30;
export const MIN_PASSWORD = 12;
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;

const DDL = `
create table people (
  name text primary key, email text not null unique, hash text not null,
  gen integer not null default 1, created_at text not null, changed_at text not null
) strict;
create table sessions (token_hash text primary key, person text not null references people (name), gen integer not null, created_at text not null, expires_at text not null, revoked_at text) strict;
create table resets (token_hash text primary key, person text not null references people (name), created_at text not null, expires_at text not null, used_at text) strict;
create table audit (seq integer primary key autoincrement, at text not null, action text not null, ok integer not null, person text, ip text, detail text) strict;
create trigger audit_no_update before update on audit begin select raise(abort, 'the audit log is append-only'); end;
create trigger audit_no_delete before delete on audit begin select raise(abort, 'the audit log is append-only'); end;
`;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const norm = (pw: string) => pw.normalize("NFKC");
const derive = (pw: string, salt: Buffer, n: number, r: number, p: number, len: number) =>
  new Promise<Buffer>((ok, bad) => scrypt(norm(pw), salt, len, { N: n, r, p, maxmem: 256 * n * r }, (e, key) => (e ? bad(e) : ok(key))));

/** `scrypt$N$r$p$<salt b64>$<hash b64>`: the format the earlier server used, so its hashes still work. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${(await derive(pw, salt, N, R, P, KEYLEN)).toString("base64")}`;
}
const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEYLEN).toString("base64")}`;
export async function verifyPassword(pw: string, stored: string | undefined): Promise<boolean> {
  // An unknown account costs the same work as a known one, so timing does not tell them apart.
  const [alg, n, r, p, salt, hash] = (stored ?? DUMMY).split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await derive(pw, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), want.length);
  return timingSafeEqual(got, want) && stored !== undefined;
}
export function passwordProblem(pw: unknown, again?: unknown): string | null {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 1024) return "That password is too long.";
  if (again !== undefined && again !== pw) return "The two passwords do not match.";
  return null;
}

/** Slows guessing: 10 failures in 15 minutes for one address and login, 30 for one address. Kept in memory. */
export class RateLimit {
  private readonly fails = new Map<string, number[]>();
  private recent(k: string) { const t = Date.now() - 15 * 60_000; const xs = (this.fails.get(k) ?? []).filter((x) => x > t); this.fails.set(k, xs); return xs; }
  blocked(ip: string, login: string): boolean { return this.recent(`${ip}|${login.toLowerCase()}`).length >= 10 || this.recent(ip).length >= 30; }
  fail(ip: string, login: string): void { for (const k of [`${ip}|${login.toLowerCase()}`, ip]) this.recent(k).push(Date.now()); }
  ok(ip: string, login: string): void { this.fails.delete(`${ip}|${login.toLowerCase()}`); }
}

export type Person = { name: string; email: string };
type PersonRow = Person & { hash: string; gen: number };
export type Done = { ok: true } | { ok: false; error: string };

export class People {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) { this.db = db; }

  static open(dir: string): People {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "_system.sqlite");
    const fresh = !existsSync(file);
    const db = new DatabaseSync(file);
    db.exec("pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on; pragma busy_timeout = 5000;");
    if (fresh) db.exec(DDL);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
    return new People(db);
  }

  private one<T>(sql: string, ...p: SQLInputValue[]): T | undefined { return this.db.prepare(sql).get(...p) as T | undefined; }
  private run(sql: string, ...p: SQLInputValue[]): void { this.db.prepare(sql).run(...p); }
  private log(action: string, ok: boolean, person: string | null, ip: string | null, detail: string | null = null): void {
    this.run("insert into audit (at, action, ok, person, ip, detail) values (?, ?, ?, ?, ?, ?)", now(), action, ok ? 1 : 0, person, ip, detail);
  }

  any(): boolean { return this.one("select 1 from people limit 1") !== undefined; }
  list(): Person[] { return (this.db.prepare("select name, email from people order by name").all() as Person[]).map((p) => ({ name: p.name, email: p.email })); }
  actor(p: Person): Actor { return { kind: "person", name: p.name, role: "admin" }; }

  /** Add a person with an already-made hash (the importer) or a password. */
  async add(name: string, email: string, secret: { password: string } | { hash: string }): Promise<void> {
    if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(name)) throw invalid(`bad name: ${name}`);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw invalid("that is not an email address");
    if ("password" in secret) { const bad = passwordProblem(secret.password); if (bad) throw invalid(bad); }
    const hash = "hash" in secret ? secret.hash : await hashPassword(secret.password);
    if (this.one("select 1 from people where name = ? or email = ?", name, email.toLowerCase())) throw invalid(`${name} or ${email} already has an account`);
    this.run("insert into people (name, email, hash, created_at, changed_at) values (?, ?, ?, ?, ?)", name, email.toLowerCase(), hash, now(), now());
    this.log("account_added", true, name, null);
  }

  /** Sign in with email and password. Returns the session token (the cookie value), or null. */
  async signIn(email: string, password: string, ip: string): Promise<string | null> {
    const p = this.one<PersonRow>("select * from people where email = ?", email.trim().toLowerCase());
    if (!(await verifyPassword(password, p?.hash)) || !p) { this.log("signin", false, p?.name ?? null, ip); return null; }
    const token = randomBytes(32).toString("hex");
    this.run("insert into sessions (token_hash, person, gen, created_at, expires_at) values (?, ?, ?, ?, ?)", sha(token), p.name, p.gen, now(), later(SESSION_DAYS * 86_400_000));
    this.log("signin", true, p.name, ip);
    return token;
  }

  /** The person behind a session token, while the session is live and the password has not changed since. */
  session(token: string | null | undefined): Person | null {
    if (!token) return null;
    const p = this.one<Person>(
      `select p.name, p.email from sessions s join people p on p.name = s.person
       where s.token_hash = ? and s.revoked_at is null and s.expires_at > ? and s.gen = p.gen`, sha(token), now());
    return p ? { name: p.name, email: p.email } : null;
  }

  signOut(token: string, ip: string): void {
    const who = this.session(token);
    this.run("update sessions set revoked_at = ? where token_hash = ? and revoked_at is null", now(), sha(token));
    this.log("signout", true, who?.name ?? null, ip);
  }

  private setPassword(name: string, hash: string): void {
    // A new `gen` ends every session made with the old password.
    this.run("update people set hash = ?, gen = gen + 1, changed_at = ? where name = ?", hash, now(), name);
  }

  /** Change the password of the signed-in person. Every other session ends; this one continues. */
  async changePassword(token: string, current: string, next: string, again: string, ip: string): Promise<Done> {
    const who = this.session(token);
    if (!who) return { ok: false, error: "Sign in first." };
    const p = this.one<PersonRow>("select * from people where name = ?", who.name)!;
    if (!(await verifyPassword(current, p.hash))) { this.log("password_change", false, p.name, ip); return { ok: false, error: "The current password is not right." }; }
    const bad = passwordProblem(next, again);
    if (bad) return { ok: false, error: bad };
    this.setPassword(p.name, await hashPassword(next));
    this.run("update sessions set gen = gen + 1 where token_hash = ?", sha(token));
    this.log("password_change", true, p.name, ip);
    return { ok: true };
  }

  /** Set a person's password outright. Only for a caller already proven to be the owner (a trusted request). */
  async setPasswordOf(name: string, next: string, again: string): Promise<Done> {
    const bad = passwordProblem(next, again);
    if (bad) return { ok: false, error: bad };
    if (!this.one("select 1 from people where name = ?", name)) return { ok: false, error: `no account ${name}` };
    this.setPassword(name, await hashPassword(next));
    this.log("password_set_from_trusted", true, name, null);
    return { ok: true };
  }

  /** A one-time reset token for a person, good for 30 minutes. The operator hands it over; no email is sent. */
  makeReset(email: string): string {
    const p = this.one<PersonRow>("select * from people where email = ?", email.trim().toLowerCase());
    if (!p) throw invalid(`no account with email ${email}`);
    const token = `rspw_${randomBytes(32).toString("hex")}`;
    this.run("insert into resets (token_hash, person, created_at, expires_at) values (?, ?, ?, ?)", sha(token), p.name, now(), later(RESET_MINUTES * 60_000));
    this.log("reset_made", true, p.name, null);
    return token;
  }

  async useReset(token: string, next: string, again: string, ip: string): Promise<Done> {
    const r = this.one<{ person: string }>("select person from resets where token_hash = ? and used_at is null and expires_at > ?", sha(token), now());
    if (!r) { this.log("reset_used", false, null, ip); return { ok: false, error: "That reset link is not valid any more. Ask for a new one." }; }
    const bad = passwordProblem(next, again);
    if (bad) return { ok: false, error: bad };
    this.run("update resets set used_at = ? where token_hash = ?", now(), sha(token));
    this.setPassword(r.person, await hashPassword(next));
    this.log("reset_used", true, r.person, ip);
    return { ok: true };
  }

  close(): void { this.db.close(); }
}

export function cookieOf(header: string | undefined, name = SESSION_COOKIE): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}
