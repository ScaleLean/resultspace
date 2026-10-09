// The Curator's settings for one company, kept in the company's own file. No Pi Durable here.
import type { Company } from "../core/company.ts";

export type CuratorSettings = {
  /** Review agent writes, write the daily briefing and do upkeep without being asked. Chat always works. */
  auto: boolean;
  /** Model for reviews and chat (cheap), and for briefings and upkeep (stronger). */
  model: string;
  model_strong: string;
  thinking: "off" | "low" | "medium" | "high";
  /** The most the Curator may spend on this company in one day, in dollars. 0 = no limit. */
  daily_cap_usd: number;
  /** Standing instructions from the owner, added to every run. */
  instructions: string;
};

export const DEFAULTS: CuratorSettings = {
  auto: (process.env.RS_CURATOR_AUTO ?? "on") !== "off",
  model: process.env.RS_CURATOR_MODEL ?? "accounts/fireworks/models/glm-5p3-flash",
  model_strong: process.env.RS_CURATOR_MODEL_STRONG ?? "accounts/fireworks/models/glm-5p3",
  thinking: "low",
  daily_cap_usd: 2,
  instructions: "",
};

export const getMeta = (co: Company, k: string): string | undefined => co.one<{ v: string }>("select v from meta where k = ?", k)?.v;
export const setMeta = (co: Company, k: string, v: string): void => co.run("insert into meta (k, v) values (?, ?) on conflict (k) do update set v = excluded.v", k, v);

export function getSettings(co: Company): CuratorSettings {
  const raw = getMeta(co, "curator.settings");
  return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<CuratorSettings>) } : DEFAULTS;
}

export function saveSettings(co: Company, change: Partial<CuratorSettings>): CuratorSettings {
  const next = { ...getSettings(co), ...Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) } as CuratorSettings;
  setMeta(co, "curator.settings", JSON.stringify(next));
  return next;
}
