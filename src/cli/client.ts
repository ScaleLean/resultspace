// Talks to the server. One request per call; every call names its company by the key it sends.
import { randomUUID } from "node:crypto";
import { CliError, readKey, type Config } from "./config.ts";

type ErrorBody = { error?: { code?: string; message?: string } };
const EXIT: Record<string, [number, string]> = {
  not_found: [4, "forbidden"], forbidden: [4, "forbidden"], invalid: [6, "rejected"], conflict: [5, "conflict"], unauthorized: [3, "auth"],
};

async function request(cfg: Config, slug: string, method: string, path: string, body?: unknown, write = false): Promise<unknown> {
  const headers: Record<string, string> = { authorization: `Bearer ${readKey(cfg, slug)}`, "content-type": "application/json" };
  if (write) headers["idempotency-key"] = randomUUID();
  let res: Response;
  try {
    res = await fetch(cfg.server_url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new CliError(7, "offline", `cannot reach ${cfg.server_url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : {}; } catch { throw new CliError(1, "error", `${cfg.server_url} answered ${res.status} with something that is not JSON`); }
  if (!res.ok) {
    const err = (json as ErrorBody).error ?? {};
    const [code, kind] = EXIT[err.code ?? ""] ?? [1, "error"];
    throw new CliError(code, kind, err.message ?? `server answered ${res.status}`);
  }
  return json;
}

/** Run one operation in a company. */
export async function call<T = unknown>(cfg: Config, slug: string, name: string, input: unknown = {}, write = false): Promise<T> {
  return ((await request(cfg, slug, "POST", `/v1/op/${name}`, input, write)) as { result: T }).result;
}

export type Me = { actor: { kind: string; name: string; role: string }; company: { slug: string; name: string }; version: string };
export const me = (cfg: Config, slug: string) => request(cfg, slug, "GET", "/v1/me") as Promise<Me>;
