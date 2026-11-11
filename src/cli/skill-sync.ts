// Reconcile exported copies, never the user's skill library. Preview reads; apply backs up owned bytes.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import type { SkillItem } from "../operations/skills.ts";

export type ExportedSkill = { company: string; key: string; markdown: string; pinned: boolean };
type Owned = { path: string; hash: string; company: string; key: string; pinned: boolean };
type Manifest = { version: 1; company: string; files: Owned[] };
type Step = { action: "write" | "update" | "archive"; path: string; expected: string | null; next?: ExportedSkill };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const slug = /^[a-z0-9][a-z0-9-]{0,62}$/;
const key = /^[A-Z]{2,6}-N?\d{3,}$/;
const pathOf = (s: { company: string; key: string }) => {
  if (!slug.test(s.company) || !key.test(s.key)) throw new Error("invalid skill source identity");
  return `${s.company}-${s.key.toLowerCase()}/SKILL.md`;
};
/** A symlink at any existing path component is not a managed path. */
function ordinary(path: string): void {
  let at = parse(resolve(path)).root;
  for (const part of resolve(path).slice(at.length).split("/")) {
    at = join(at, part);
    if (existsSync(at) || (() => { try { return lstatSync(at).isSymbolicLink(); } catch { return false; } })()) {
      if (lstatSync(at).isSymbolicLink()) throw new Error("skill sync refuses symlink paths");
    }
  }
}
const pin = (file: string, content: string) => existsSync(join(dirname(file), ".pinned")) || /^pinned:[ \t]*true[ \t]*$/mi.test(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? "");

/** Enumerate each source independently; an absent page never silently hides active skills. */
export async function enumerateSkills(fetchPage: (scope: "own" | "shared", after?: string) => Promise<SkillItem[]>): Promise<SkillItem[]> {
  const result: SkillItem[] = [];
  for (const scope of ["own", "shared"] as const) {
    let after: string | undefined; const seen = new Set<string>();
    while (true) {
      const page = await fetchPage(scope, after);
      if (!page.length) break;
      result.push(...page);
      const next = page.at(-1)!.cursor;
      if (!next || seen.has(next)) throw new Error("server did not provide advancing skill pagination; no files synchronized");
      seen.add(next); after = next;
    }
  }
  return result;
}

export function syncSkills(directory: string, company: string, desired: ExportedSkill[], preview = false) {
  if (!slug.test(company)) throw new Error("invalid sync company");
  const root = resolve(directory); ordinary(root);
  const manifestPath = join(root, `.resultspace-sync-${company}.json`); ordinary(manifestPath);
  const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null;
  const manifest = originalManifest ? JSON.parse(originalManifest) as Manifest : { version: 1 as const, company, files: [] };
  if (manifest.version !== 1 || manifest.company !== company || !Array.isArray(manifest.files)) throw new Error("invalid skill ownership manifest");
  const owned = new Map<string, Owned>();
  for (const file of manifest.files) {
    if (file.path !== pathOf(file) || !/^[a-f0-9]{64}$/.test(file.hash) || typeof file.pinned !== "boolean" || owned.has(file.path)) throw new Error("invalid skill ownership entry");
    ordinary(join(root, file.path)); owned.set(file.path, file);
  }
  const wanted = new Map<string, ExportedSkill>();
  for (const s of desired) {
    const path = pathOf(s); ordinary(join(root, path));
    if (wanted.has(path)) throw new Error("duplicate exported skill identity");
    wanted.set(path, s);
  }
  const steps: Step[] = []; const protectedFiles: { path: string; reason: string }[] = [];
  for (const path of new Set([...owned.keys(), ...wanted.keys()])) {
    const previous = owned.get(path); const next = wanted.get(path); const file = join(root, path);
    const content = existsSync(file) ? readFileSync(file, "utf8") : null;
    const currentHash = content == null ? null : hash(content);
    if (content != null && (!previous || previous.hash !== currentHash)) { protectedFiles.push({ path, reason: previous ? "local edits" : "user-owned or unmanaged" }); continue; }
    if (content != null && (previous?.pinned || pin(file, content))) { protectedFiles.push({ path, reason: "pinned" }); continue; }
    if (!next) {
      if (content != null) steps.push({ action: "archive", path, expected: currentHash });
      else owned.delete(path);
    } else if (content == null || currentHash !== hash(next.markdown)) steps.push({ action: content == null ? "write" : "update", path, expected: currentHash, next });
    else owned.set(path, { path, company: next.company, key: next.key, hash: currentHash, pinned: next.pinned });
  }
  const result = { dir: root, manifest: manifestPath, preview, plan: steps.map(({ action, path }) => ({ action, path })), protected: protectedFiles,
    written: [] as string[], archived: [] as string[], backup: null as string | null };
  if (preview) return result;
  // All API enumeration and ownership validation precede any write. Recheck before backing up/applying.
  ordinary(root); mkdirSync(root, { recursive: true });
  const backup = join(root, `.resultspace-backups-${company}`, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  ordinary(backup);
  if (steps.length || originalManifest) {
    mkdirSync(backup, { recursive: true }); result.backup = backup;
    if (originalManifest) writeFileSync(join(backup, "manifest.json"), originalManifest, { flag: "wx", mode: 0o600 });
  }
  for (const step of steps) {
    const file = join(root, step.path); ordinary(file);
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    if ((current == null ? null : hash(current)) !== step.expected || (current != null && pin(file, current))) throw new Error("skill changed during sync; retained backups, run preview again");
    if (current != null) {
      const saved = join(backup, step.path); ordinary(saved); mkdirSync(dirname(saved), { recursive: true });
      renameSync(file, saved); // Archive exactly this owned file, never its directory or neighbors.
    }
    if (step.next) {
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, step.next.markdown, { flag: "wx", mode: 0o600 });
      owned.set(step.path, { path: step.path, company: step.next.company, key: step.next.key, hash: hash(step.next.markdown), pinned: step.next.pinned });
      result.written.push(dirname(file));
    } else { owned.delete(step.path); result.archived.push(file); }
  }
  ordinary(manifestPath);
  if ((existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null) !== originalManifest) throw new Error("ownership manifest changed during sync; retained backups");
  const temporary = join(root, `.resultspace-manifest-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify({ version: 1, company, files: [...owned.values()] }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  renameSync(temporary, manifestPath);
  return result;
}
