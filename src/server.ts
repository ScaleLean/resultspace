// The ResultSpace server: one process, every company file in DATA_DIR.
// Run: node src/server.ts   (env: PORT, HOST, DATA_DIR, RS_TRUST=loopback|tailnet|none, FIREWORKS_API_KEY, RS_TZ, RS_BRIEFING_HOUR, RS_CURATOR_AUTO, RS_SHARED_COMPANY)
// /health, /v1 and /mcp are the API for agents (keys). Everything else is the web app for people (sign-in),
// built by `npm run build` into build/. The web app reaches data only through req.rs (src/web/service.ts).
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Companies } from "./core/companies.ts";
import { People } from "./core/people.ts";
import { Curator, type FauxProvider } from "./curator/curator.ts";
import { loadModelKey } from "./core/modelkey.ts";
import { parseTrust, trusted, type Trust } from "./core/trust.ts";
import { handleApi, send } from "./surfaces/http.ts";
import { setSharedCompany } from "./operations/skills.ts";
import { webFor, type WebService } from "./web/service.ts";

export type WebRequest = IncomingMessage & { rs?: WebService };
type KitHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

// A browser sends Origin on a cross-site POST, and modern ones send Sec-Fetch-Site. Refuse writes from other sites.
function crossSite(req: IncomingMessage): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const sfs = String(req.headers["sec-fetch-site"] ?? "");
  if (sfs === "same-origin" || sfs === "none") return false;
  if (sfs === "cross-site" || sfs === "same-site") return true;
  const o = req.headers.origin;
  if (!o) return false;
  try { return new URL(o).host !== req.headers.host; } catch { return true; }
}

export async function startServer(o: { dataDir: string; port: number; host: string; trust?: Trust | undefined; faux?: FauxProvider | undefined; webBuild?: string | undefined; tick?: number | undefined; sharedCompany?: string | undefined }) {
  const trust = o.trust ?? parseTrust(process.env.RS_TRUST);
  if (!o.faux) loadModelKey(o.dataDir);
  const companies = new Companies(o.dataDir);
  const people = People.open(o.dataDir);
  // Skills in the shared company are readable with any key (env RS_SHARED_COMPANY, default payload-shared).
  const sharedSlug = o.sharedCompany ?? process.env.RS_SHARED_COMPANY ?? "payload-shared";
  setSharedCompany(() => (companies.slugs().includes(sharedSlug) ? companies.get(sharedSlug) : undefined));
  const curator = new Curator(companies, { dataDir: o.dataDir, faux: o.faux, person: people.list()[0]?.name });
  const kitFile = o.webBuild ?? join(import.meta.dirname, "..", "build", "handler.js");
  // SvelteKit compares a form's Origin with the request's; tell it the scheme the client really used.
  process.env.PROTOCOL_HEADER ??= "x-forwarded-proto";
  process.env.HOST_HEADER ??= "host";
  const kit: KitHandler | null = existsSync(kitFile) ? ((await import(pathToFileURL(kitFile).href)) as { handler: KitHandler }).handler : null;
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (await handleApi(companies, req, res)) return;
        if (crossSite(req)) return send(res, 403, { error: { code: "forbidden", message: "cross-site request refused" } });
        if (!kit) return send(res, 503, { error: { code: "unavailable", message: "the web app is not built: run `npm run build`" } });
        if (!req.headers["x-forwarded-proto"]) req.headers["x-forwarded-proto"] = "http";
        (req as WebRequest).rs = webFor(req, { companies, people, curator, dataDir: o.dataDir, trusted: trusted(req.socket.remoteAddress, trust) });
        kit(req, res, () => send(res, 404, { error: { code: "not_found", message: "no such page" } }));
      } catch (e) {
        console.error(e);
        if (!res.headersSent) send(res, 500, { error: { code: "internal", message: "internal error" } });
      }
    })();
  });
  if (o.tick) curator.start(o.tick);
  return new Promise<{ companies: Companies; people: People; curator: Curator; port: number; trust: Trust; close: () => Promise<void> }>((ok) => {
    server.listen(o.port, o.host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : o.port;
      ok({ companies, people, curator, port, trust, close: async () => {
        await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); });
        await curator.close(); companies.close(); people.close();
      } });
    });
  });
}

if (import.meta.main) {
  const dataDir = process.env.DATA_DIR ?? join(import.meta.dirname, "..", "data");
  const s = await startServer({ dataDir, port: Number(process.env.PORT ?? 4390), host: process.env.HOST ?? "127.0.0.1", tick: Number(process.env.RS_CURATOR_TICK ?? 60) });
  console.log(`ResultSpace on port ${s.port}; trust: ${s.trust}; companies: ${s.companies.slugs().join(", ") || "(none yet)"}; curator: ${s.curator.available ? "on" : "off (no model key)"}`);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => void s.close().then(() => process.exit(0)));
}
