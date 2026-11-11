// MCP (Model Context Protocol) over HTTP: the operation list as tools. One JSON-RPC message per POST.
// The caller is an ordinary key holder, so a tool call has exactly the rights that key has, in its one company.
import type { IncomingMessage, ServerResponse } from "node:http";
import { RsError } from "../core/errors.ts";
import { operations, run } from "../operations/index.ts";
import { readJson, send, VERSION, type Caller } from "./http.ts";

const PROTOCOL = "2025-06-18";
const toolName = (op: string) => op.replace(/\./g, "_");
const byTool = new Map(operations.map((o) => [toolName(o.name), o]));

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function answer(caller: Caller, method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "resultspace", version: VERSION },
        instructions: `ResultSpace records of ${caller.company.name}. You are ${caller.actor.name} (${caller.actor.role}). Nothing can be deleted; archive instead.`,
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        // Old names kept as aliases (work.*) still answer tools/call, but are not offered.
        tools: operations.filter((o) => !o.replacedBy).map((o) => ({
          name: toolName(o.name), description: o.summary, inputSchema: o.input,
          annotations: { readOnlyHint: !o.write, destructiveHint: false },
        })),
      };
    case "tools/call": {
      const o = byTool.get(String(params.name));
      if (!o) throw new RsError("not_found", `no tool ${String(params.name)}`);
      try {
        const out = run(caller.company, caller.actor, o.name, params.arguments ?? {});
        return { content: [{ type: "text", text: JSON.stringify(out) }], isError: false };
      } catch (e) {
        // A refused call is a tool result the model can read and fix, not a protocol failure.
        if (e instanceof RsError) return { content: [{ type: "text", text: `${e.code}: ${e.message}` }], isError: true };
        throw e;
      }
    }
    default:
      throw new RsError("not_found", `method ${method} is not supported`);
  }
}

export async function handleMcp(caller: Caller, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return send(res, 405, { error: { code: "invalid", message: "POST one JSON-RPC message" } });
  const msg = obj(await readJson(req)) as Rpc;
  const method = typeof msg.method === "string" ? msg.method : "";
  if (msg.id === undefined || msg.id === null) { res.writeHead(202).end(); return; } // a notification: nothing to answer
  try {
    send(res, 200, { jsonrpc: "2.0", id: msg.id, result: answer(caller, method, obj(msg.params)) });
  } catch (e) {
    if (!(e instanceof RsError)) console.error(e);
    const code = e instanceof RsError && e.code === "not_found" ? -32601 : -32603;
    send(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code, message: e instanceof RsError ? e.message : "internal error" } });
  }
}
