// Admin operations: the company's agents and their keys, and attachments.
import { Type } from "typebox";
import { addAgent, issueKey, listAgents, revokeKeys, setAgentActive } from "../core/agents.ts";
import { getBlob, putBlob } from "../core/blobs.ts";
import { notFound } from "../core/errors.ts";
import { op, type Operation } from "./define.ts";

const Name = Type.String({ minLength: 1, maxLength: 63 });

export const adminOperations: Operation[] = [
  op({
    name: "agent.list", summary: "The agents of this company, with when each was last seen", role: "viewer", write: false,
    input: Type.Object({}),
    run: (ctx) => {
      const seen = new Map(ctx.company.all<{ agent: string; at: string }>("select agent, at from presence").map((p) => [p.agent, p.at]));
      return listAgents(ctx.company).map((a) => ({ ...a, last_seen: seen.get(a.name) ?? null }));
    },
  }),
  op({
    name: "agent.add", summary: "Add an agent to this company", role: "admin", write: true,
    input: Type.Object({ name: Name, role: Type.Optional(Type.Union([Type.Literal("viewer"), Type.Literal("member"), Type.Literal("admin")])) }),
    run: (ctx, i) => addAgent(ctx.company, i.name, i.role),
  }),
  // Not a ledger write: the answer holds the key, and the key must be stored nowhere but its hash.
  op({
    name: "agent.key", summary: "Make a new key for an agent. It is shown once", role: "admin", write: false,
    input: Type.Object({ name: Name }),
    run: (ctx, i) => ({ agent: i.name, key: issueKey(ctx.company, i.name) }),
  }),
  op({
    name: "agent.revoke", summary: "Revoke every key of an agent", role: "admin", write: true,
    input: Type.Object({ name: Name }),
    run: (ctx, i) => { revokeKeys(ctx.company, i.name); return { ok: true }; },
  }),
  op({
    name: "agent.set_active", summary: "Turn an agent off (its keys stop working) or back on", role: "admin", write: true,
    input: Type.Object({ name: Name, active: Type.Boolean() }),
    run: (ctx, i) => { setAgentActive(ctx.company, i.name, i.active); return { ok: true }; },
  }),
  op({
    name: "blob.put", summary: "Store an attachment (base64). Returns its sha256", role: "member", write: true,
    input: Type.Object({ b64: Type.String({ minLength: 1 }) }),
    run: (ctx, i) => putBlob(ctx.company, Buffer.from(i.b64, "base64")),
  }),
  op({
    name: "blob.get", summary: "Read an attachment by its sha256 (base64)", role: "viewer", write: false,
    input: Type.Object({ sha256: Type.String({ pattern: "^[0-9a-fA-F]{64}$" }) }),
    run: (ctx, i) => {
      const bytes = getBlob(ctx.company, i.sha256);
      if (!bytes) throw notFound(`attachment ${i.sha256}`);
      return { sha256: i.sha256.toLowerCase(), size: bytes.length, b64: Buffer.from(bytes).toString("base64") };
    },
  }),
];
