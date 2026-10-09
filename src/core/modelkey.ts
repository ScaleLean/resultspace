// The Curator's model key (Fireworks). Comes from the environment, or from a 0600 file in the data directory
// that first-run setup or Admin writes. Never logged, never in a database, never in an answer.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const KEY_FILE = "model.key";

export function loadModelKey(dataDir: string): boolean {
  if (process.env.FIREWORKS_API_KEY) return true;
  const file = join(dataDir, KEY_FILE);
  if (!existsSync(file)) return false;
  const key = readFileSync(file, "utf8").trim();
  if (key) process.env.FIREWORKS_API_KEY = key;
  return !!key;
}

export function saveModelKey(dataDir: string, key: string): void {
  writeFileSync(join(dataDir, KEY_FILE), `${key.trim()}\n`, { mode: 0o600 });
  process.env.FIREWORKS_API_KEY = key.trim();
}

/** One cheap real call: is the key accepted? Says why not in plain words. */
export async function testModelKey(key: string, base = process.env.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference/v1"): Promise<{ ok: boolean; message: string }> {
  if (!key.trim()) return { ok: false, message: "No key given." };
  try {
    const r = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(10_000) });
    if (r.ok) return { ok: true, message: "The key works." };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Fireworks refused the key." };
    return { ok: false, message: `Fireworks answered ${r.status}.` };
  } catch (e) {
    return { ok: false, message: `Could not reach Fireworks: ${e instanceof Error ? e.message : String(e)}` };
  }
}
