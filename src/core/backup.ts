// Offline directory rehearsal. SQLite VACUUM INTO captures a consistent snapshot including committed WAL contents.
// A quiesced server is required for consistency across company, account and Curator files.
import { DatabaseSync } from "node:sqlite";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { invalid } from "./errors.ts";
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
export async function backupDirectory(source: string, out: string, quiesced: boolean) {
  if (!quiesced) throw invalid("Stop writes and assert --quiesced for a consistent directory backup");
  if (existsSync(out)) throw invalid("Backup destination must be new");
  if (resolve(out).startsWith(resolve(source) + "/")) throw invalid("Backup destination must be outside the source");
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const manifest: { version: number; files: Record<string, string> } = { version: 1, files: {} };
  for (const name of readdirSync(source)) {
    if (name.endsWith("-wal") || name.endsWith("-shm")) continue;
    const file = join(source, name),
      target = join(out, name);
    if (name.endsWith(".sqlite")) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if ((db.prepare("pragma integrity_check").get() as { integrity_check: string }).integrity_check !== "ok")
          throw invalid(`Integrity check failed: ${name}`);
        db.prepare("vacuum into ?").run(target);
      } finally {
        db.close();
      }
    } else {
      // Include flat server-owned key/config files and migration backups. External CLI key files are separate.
      const { statSync } = await import("node:fs");
      if (!statSync(file).isFile()) throw invalid(`Unsupported directory ${name}; review backup scope`);
      copyFileSync(file, target);
    }
    chmodSync(target, 0o600);
    manifest.files[name] = digest(target);
  }
  writeFileSync(join(out, "backup-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return manifest;
}
export function restoreDirectory(source: string, out: string) {
  if (existsSync(out)) throw invalid("Restore destination must be new; never overwrite live data");
  const manifest = JSON.parse(readFileSync(join(source, "backup-manifest.json"), "utf8")) as {
    version: number;
    files: Record<string, string>;
  };
  if (manifest.version !== 1 || !manifest.files || typeof manifest.files !== "object") throw invalid("Invalid backup manifest");
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || typeof hash !== "string" || digest(join(source, name)) !== hash)
      throw invalid(`Backup verification failed: ${name}`);
    if (name.endsWith(".sqlite")) {
      const db = new DatabaseSync(join(source, name), { readOnly: true });
      try {
        if ((db.prepare("pragma integrity_check").get() as { integrity_check: string }).integrity_check !== "ok")
          throw invalid(`Integrity check failed: ${name}`);
      } finally {
        db.close();
      }
    }
  }
  mkdirSync(out, { recursive: true, mode: 0o700 });
  for (const name of Object.keys(manifest.files)) {
    copyFileSync(join(source, name), join(out, name));
    chmodSync(join(out, name), 0o600);
  }
  return { files: Object.keys(manifest.files) };
}
