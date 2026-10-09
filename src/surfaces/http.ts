// The API for agents and `rs`. Every route ends in run() from the operation list; there is no other way to
// read or write a company. A key names its company, so a request can only ever reach that one file.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Actor } from "../core/agents.ts";
import type { Companies } from "../core/companies.ts";
import type { Company } from "../core/company.ts";
import { RsError, type ErrorCode } from "../core/errors.ts";
import { operations, run } from "../operations/index.ts";
import { handleMcp } from "./mcp.ts";

export const VERSION = "0.2.0";
const MAX_BODY = 40 * 1024 * 1024; // attachments travel as base64
const STATUS: Record<ErrorCode, number> = { not_found: 404, forbidden: 403, invalid: 400, conflict: 409 };

export type Caller = { company: Company; actor: Actor };

export function send(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s), "cache-control": "no-store" });
  res.end(s);
}

export function sendError(res: ServerResponse, e: unknown): void {
  if (e instanceof RsError) return send(res, STATUS[e.code], { error: { code: e.code, message: e.message } });
  console.error(e); // never request headers or bodies: they hold keys
  send(res, 500, { error: { code: "internal", message: "internal error" } });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    const b = c as Buffer;
    n += b.length;
    if (n > MAX_BODY) throw new RsError("invalid", "request body too large");
    chunks.push(b);
  }
  if (!n) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RsError("invalid", "request body is not JSON");
  }
}

/** The caller behind a request's Bearer key, or undefined. */
export function callerOf(companies: Companies, req: IncomingMessage): Caller | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  return m?.[1] ? companies.authenticate(m[1]) : undefined;
}

/** What a client needs to build commands and tools: every operation with the JSON Schema of its input. */
export const operationList = () => operations.map((o) => ({ name: o.name, summary: o.summary, role: o.role, write: o.write, input: o.input, ...(o.replacedBy ? { replaced_by: o.replacedBy } : {}) }));

/**
 * Answer /health, /v1/* and /mcp. Returns false for any other path, so the web app can take it.
 * A bad key, a revoked key and an unknown company all get the same 401.
 */
export async function handleApi(companies: Companies, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  if (p === "/health") { send(res, 200, { ok: true, service: "resultspace", version: VERSION }); return true; }
  if (p !== "/mcp" && !p.startsWith("/v1/")) return false;
  try {
    const caller = callerOf(companies, req);
    if (!caller) { send(res, 401, { error: { code: "unauthorized", message: "missing or invalid key" } }); return true; }
    if (p === "/mcp") { await handleMcp(caller, req, res); return true; }
    if (p === "/v1/me" && req.method === "GET") {
      send(res, 200, { actor: caller.actor, company: { slug: caller.company.slug, name: caller.company.name }, version: VERSION });
      return true;
    }
    if (p === "/v1/operations" && req.method === "GET") { send(res, 200, { operations: operationList() }); return true; }
    const m = /^\/v1\/op\/([a-z_.]+)$/.exec(p);
    if (m?.[1] && req.method === "POST") {
      const opId = req.headers["idempotency-key"];
      const result = run(caller.company, caller.actor, m[1], await readJson(req), typeof opId === "string" ? opId : undefined);
      send(res, 200, { result });
      return true;
    }
    send(res, 404, { error: { code: "not_found", message: "no such route" } });
  } catch (e) {
    if (!res.headersSent) sendError(res, e);
  }
  return true;
}
