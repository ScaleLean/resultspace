#!/usr/bin/env node
import { backupDirectory, restoreDirectory } from "../src/core/backup.ts";
const [verb, source, out, ...flags] = process.argv.slice(2);
if (!source || !out || !["backup", "restore"].includes(verb ?? ""))
  throw new Error("usage: node scripts/data-rehearsal.ts backup SOURCE NEW_DEST --quiesced | restore BACKUP NEW_DEST");
console.log(
  JSON.stringify(
    verb === "backup" ? await backupDirectory(source, out, flags.includes("--quiesced")) : restoreDirectory(source, out),
    null,
    2,
  ),
);
