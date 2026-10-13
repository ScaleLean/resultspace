// Fixed for the lifetime of a server. Invalid settings refuse startup rather than allowing writes.
import { RsError } from "./errors.ts";

export function parseReadOnly(value: string | undefined): boolean {
  if (value === undefined || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new Error("RS_READ_ONLY must be 1 or true (enabled), or 0 or false (disabled)");
}

export function assertWritable(readOnly: boolean): void {
  if (readOnly) throw new RsError("read_only", "ResultSpace is read-only for historical migration reconciliation.");
}
