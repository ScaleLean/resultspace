// Attachments, stored in the company's file under the sha256 of their bytes. Never changed, never deleted.
import { createHash } from "node:crypto";
import type { Company } from "./company.ts";

export function putBlob(co: Company, bytes: Uint8Array, at = new Date().toISOString()): { sha256: string; size: number } {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  co.run("insert or ignore into blobs (sha256, size, bytes, at) values (?, ?, ?, ?)", sha256, bytes.length, bytes, at);
  return { sha256, size: bytes.length };
}

export function getBlob(co: Company, sha256: string): Uint8Array | undefined {
  return co.one<{ bytes: Uint8Array }>("select bytes from blobs where sha256 = ?", sha256.toLowerCase())?.bytes;
}
