// A company's agents and their keys live in that company's file. A key works for one company only.
import { createHash, randomBytes } from "node:crypto";
import type { Company } from "./company.ts";
import { invalid, notFound } from "./errors.ts";

export const ROLES = ["viewer", "member", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const roleRank = (r: Role): number => ROLES.indexOf(r);

/** Whoever is acting: a person, an agent of this company, or the Curator. */
export type Actor = { kind: "person" | "agent" | "curator"; name: string; role: Role };
export type Agent = { name: string; role: Role; active: boolean; created_at: string };

type AgentRow = { name: string; role: Role; active: number; created_at: string };
const toAgent = (r: AgentRow): Agent => ({ ...r, active: r.active === 1 });
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export function listAgents(co: Company): Agent[] {
  return co.all<AgentRow>("select * from agents order by name").map(toAgent);
}

export function addAgent(co: Company, name: string, role: Role = "member"): Agent {
  if (!/^[a-z0-9][a-z0-9:._-]{0,62}$/.test(name)) throw invalid(`bad agent name: ${name}`);
  if (co.one("select 1 from agents where name = ?", name)) throw invalid(`agent ${name} already exists`);
  co.run("insert into agents (name, role, created_at) values (?, ?, ?)", name, role, new Date().toISOString());
  return toAgent(co.one<AgentRow>("select * from agents where name = ?", name)!);
}

/** Turn an agent off (its keys stop working) or back on. */
export function setAgentActive(co: Company, name: string, active: boolean): void {
  if (!co.one("select 1 from agents where name = ?", name)) throw notFound(`agent ${name}`);
  co.run("update agents set active = ? where name = ?", active ? 1 : 0, name);
}

/**
 * Make a key for an agent. The key is returned once and only its hash is stored.
 * It carries the company slug (rsk_<slug>_<secret>), so the server knows which one file to look in.
 */
export function issueKey(co: Company, agent: string): string {
  if (!co.one("select 1 from agents where name = ?", agent)) throw notFound(`agent ${agent}`);
  const key = `rsk_${co.slug}_${randomBytes(24).toString("base64url")}`;
  co.run("insert into agent_keys (key_hash, agent, created_at) values (?, ?, ?)", hash(key), agent, new Date().toISOString());
  return key;
}

export function revokeKeys(co: Company, agent: string): void {
  co.run("update agent_keys set revoked_at = ? where agent = ? and revoked_at is null", new Date().toISOString(), agent);
}

/** The company slug a key names, without looking anything up. */
export function slugOfKey(key: string): string | undefined {
  const m = /^rsk_([a-z0-9][a-z0-9-]{0,62})_[A-Za-z0-9_-]{20,}$/.exec(key);
  return m?.[1];
}

/** The agent a key belongs to, when the key is this company's, not revoked, and the agent is on. */
export function agentOfKey(co: Company, key: string): Actor | undefined {
  if (slugOfKey(key) !== co.slug) return undefined;
  const r = co.one<{ name: string; role: Role }>(
    `select a.name, a.role from agent_keys k join agents a on a.name = k.agent
     where k.key_hash = ? and k.revoked_at is null and a.active = 1`,
    hash(key),
  );
  return r ? { kind: "agent", name: r.name, role: r.role } : undefined;
}
