// What the web app may do, for one request. The web app (SvelteKit) reaches the server ONLY through this
// object: it never opens a company file, and every read and write goes through run() as the signed-in person.
// Every method except signIn and useReset refuses when nobody is signed in.
import type { IncomingMessage } from "node:http";
import type { Companies } from "../core/companies.ts";
import { forbidden, RsError } from "../core/errors.ts";
import { cookieOf, passwordProblem, RateLimit, SESSION_COOKIE, SESSION_DAYS, type Done, type People, type Person } from "../core/people.ts";
import type { ChatState, Curator, RunReport } from "../curator/curator.ts";
import { getSettings, saveSettings, type CuratorSettings } from "../curator/settings.ts";
import { saveModelKey, testModelKey } from "../core/modelkey.ts";
import { SLUG } from "../core/company.ts";
import { operations, run } from "../operations/index.ts";

export type OpResult<T = unknown> = { ok: true; result: T } | { ok: false; code: string; error: string };
export type CuratorView = { available: boolean; settings: CuratorSettings; spent_today: number; chat: ChatState; runs: { id: number; duty: string; started_at: string; finished_at: string | null; status: string; detail: string | null; cost_usd: number }[] };

export type WebService = {
  /** The signed-in person, or null. In trusted mode (loopback, tailnet) the owner, without signing in. */
  person: Person | null;
  /** "trusted": this request needs no sign-in (same machine or tailnet). "signin": it does. */
  mode: "trusted" | "signin";
  /** True on first run: no company yet (trusted), or no account yet (sign-in). The web app then shows set-up. */
  needsSetup: boolean;
  /** Make a company (admin; the only way companies come to be from the web). */
  createCompany(slug: string, name: string): { ok: true; slug: string } | { ok: false; error: string };
  modelKey: {
    /** Is the Curator's model key set? */
    status(): { set: boolean; curator: boolean };
    test(key: string): Promise<{ ok: boolean; message: string }>;
    /** Save the key (0600 file in the data directory) and turn the Curator on. */
    set(key: string): Promise<{ ok: boolean; message: string }>;
  };
  setup(name: string, email: string, password: string): Promise<Done & { cookie?: string }>;
  signIn(email: string, password: string): Promise<{ ok: true; cookie: string } | { ok: false; error: string; status: number }>;
  signOut(): { cookie: string };
  changePassword(current: string, next: string, again: string): Promise<Done>;
  /** Access from elsewhere. In trusted mode the owner may make the sign-in account or set its password without the old one. */
  access(): { mode: "trusted" | "signin"; account: { name: string; email: string } | null };
  setAccount(name: string, email: string, password: string, again: string): Promise<Done>;
  setPassword(next: string, again: string): Promise<Done>;
  useReset(token: string, next: string, again: string): Promise<Done>;
  /** Companies on this server. */
  companies(): { slug: string; name: string }[];
  /** Names and summaries of every operation (for forms and debugging). */
  operations(): { name: string; summary: string; write: boolean }[];
  /** Run one operation in a company as the signed-in person. Never throws for a refused call: check `ok`. */
  run<T = unknown>(slug: string, operation: string, input?: unknown): OpResult<T>;
  curator: {
    view(slug: string): Promise<CuratorView>;
    chat(slug: string): Promise<ChatState>;
    say(slug: string, text: string, steer?: boolean): Promise<Done>;
    stop(slug: string): Promise<void>;
    newChat(slug: string): Promise<void>;
    saveSettings(slug: string, change: Partial<CuratorSettings>): CuratorSettings;
    /** Run a duty now: "review" | "briefing" | "upkeep". */
    runDuty(slug: string, duty: "review" | "briefing" | "upkeep"): Promise<RunReport | null>;
  };
};

const limiter = new RateLimit();
// The socket address, never a header: a header can be forged.
const clientIp = (req: IncomingMessage) => String(req.socket.remoteAddress || "?");
const isHttps = (req: IncomingMessage) => String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() === "https";
const cookie = (req: IncomingMessage, value: string, maxAge: number) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;

export type WebDeps = { companies: Companies; people: People; curator: Curator; dataDir: string; trusted: boolean };

export function webFor(req: IncomingMessage, deps: WebDeps): WebService {
  const { companies, people, curator } = deps;
  const token = cookieOf(req.headers.cookie);
  // Trusted request: the signed-in person if there is one, else the owner (the first account, or "owner").
  const owner = people.list()[0] ?? { name: "owner", email: "" };
  const person = people.session(token) ?? (deps.trusted ? owner : null);
  const ip = clientIp(req);
  const me = (): Person => { if (!person) throw forbidden("sign in first"); return person; };
  const company = (slug: string) => { me(); return companies.get(slug); };
  const empty: ChatState = { busy: false, messages: [], partial: null, tools: [] };
  return {
    person,
    mode: deps.trusted ? "trusted" : "signin",
    needsSetup: deps.trusted ? companies.slugs().length === 0 : !people.any(),
    createCompany(slug, name) {
      me();
      if (!SLUG.test(slug)) return { ok: false, error: "A slug is lower-case letters, digits and dashes, like acme or north-wind." };
      if (!name.trim()) return { ok: false, error: "Give the company a name." };
      try { companies.create(slug, name.trim()); return { ok: true, slug }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    },
    modelKey: {
      status() { me(); return { set: !!process.env.FIREWORKS_API_KEY, curator: curator.available }; },
      async test(key) { me(); return testModelKey(key); },
      async set(key) {
        me();
        const t = await testModelKey(key);
        if (!t.ok) return t;
        saveModelKey(deps.dataDir, key); curator.enable();
        return { ok: true, message: "Saved. The Curator is on." };
      },
    },
    async setup(name, email, password) {
      if (people.any()) return { ok: false, error: "This server is already set up." };
      try { await people.add(name, email, { password }); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
      const t = await people.signIn(email, password, ip);
      return t ? { ok: true, cookie: cookie(req, t, SESSION_DAYS * 86400) } : { ok: false, error: "Could not sign in." };
    },
    async signIn(email, password) {
      if (limiter.blocked(ip, email)) return { ok: false, error: "Too many tries. Wait 15 minutes and try again.", status: 429 };
      const t = await people.signIn(email, password, ip);
      if (!t) { limiter.fail(ip, email); return { ok: false, error: "That email and password do not match.", status: 401 }; }
      limiter.ok(ip, email);
      return { ok: true, cookie: cookie(req, t, SESSION_DAYS * 86400) };
    },
    signOut() { if (token) people.signOut(token, ip); return { cookie: cookie(req, "", 0) }; },
    access() { me(); const a = people.list()[0]; return { mode: deps.trusted ? "trusted" : "signin", account: a ? { name: a.name, email: a.email } : null }; },
    async setAccount(name, email, password, again) {
      me();
      if (!deps.trusted) return { ok: false, error: "Only from the machine that runs ResultSpace, or its network." };
      if (people.any()) return { ok: false, error: "There is already an account. Set its password instead." };
      const bad = passwordProblem(password, again);
      if (bad) return { ok: false, error: bad };
      try { await people.add(name, email, { password }); return { ok: true }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    },
    async setPassword(next, again) {
      me();
      if (!deps.trusted) return { ok: false, error: "Only from the machine that runs ResultSpace, or its network. Use the current password here." };
      const a = people.list()[0];
      if (!a) return { ok: false, error: "There is no account yet." };
      return people.setPasswordOf(a.name, next, again);
    },
    async changePassword(current, next, again) { me(); return people.changePassword(token!, current, next, again, ip); },
    async useReset(resetToken, next, again) {
      if (limiter.blocked(ip, "#reset")) return { ok: false, error: "Too many tries. Wait 15 minutes and try again." };
      const r = await people.useReset(resetToken, next, again, ip);
      if (!r.ok) limiter.fail(ip, "#reset");
      return r;
    },
    companies() { me(); return companies.slugs().map((slug) => ({ slug, name: companies.get(slug).name })); },
    operations() { me(); return operations.map((o) => ({ name: o.name, summary: o.summary, write: o.write })); },
    run<T>(slug: string, operation: string, input: unknown = {}): OpResult<T> {
      try { return { ok: true, result: run(company(slug), people.actor(me()), operation, input) as T }; }
      catch (e) { if (e instanceof RsError) return { ok: false, code: e.code, error: e.message }; throw e; }
    },
    curator: {
      async view(slug) {
        const co = company(slug);
        if (!curator.available) return { available: false, settings: getSettings(co), spent_today: 0, chat: empty, runs: [] };
        const c = await curator.for(slug);
        return { available: true, settings: getSettings(co), spent_today: await c.spentToday(), chat: await c.chat(), runs: c.runs() };
      },
      async chat(slug) { company(slug); return curator.available ? (await curator.for(slug)).chat() : empty; },
      async say(slug, text, steer = false) {
        company(slug);
        if (!curator.available) return { ok: false, error: "The Curator is off: this server has no model key (FIREWORKS_API_KEY)." };
        if (!text.trim()) return { ok: false, error: "Say something first." };
        return (await curator.for(slug)).say(text.slice(0, 8000), steer);
      },
      async stop(slug) { company(slug); if (curator.available) await (await curator.for(slug)).stop(); },
      async newChat(slug) { company(slug); if (curator.available) await (await curator.for(slug)).newChat(); },
      saveSettings(slug, change) { return saveSettings(company(slug), change); },
      async runDuty(slug, duty) {
        company(slug);
        if (!curator.available) return null;
        const c = await curator.for(slug);
        return duty === "review" ? c.review() : duty === "briefing" ? c.briefing(me().name, process.env.RS_TZ ?? "America/Denver", true) : c.upkeep(process.env.RS_TZ ?? "America/Denver", true);
      },
    },
  };
}
