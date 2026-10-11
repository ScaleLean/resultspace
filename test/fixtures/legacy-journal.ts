// Synthetic historical records only; no live or copied company contents.
import type { Company } from "../../src/core/company.ts";
import { uuidv7 } from "../../src/core/records.ts";

export function legacyJournal(co: Company) {
  const put = (key: string, kind: string, body: Record<string, unknown>) => {
    const id = uuidv7(), text = JSON.stringify(body);
    co.run("insert into records values (?,?,?,1,?,0,'2026-09-01','2026-09-01','historical-author')", id, key, kind, text);
    co.run("insert into revisions(record_id,rev,body,archived,changed,op,actor,actor_kind,at) values (?,1,?,0,'[]','import','historical-author','person','2026-09-01')", id, text);
    return { id, key };
  };
  const titled = put("KNW-0901", "knowledge", { title: "Historical supplier evidence", body: "Synthetic preserved claim" });
  const untitled = put("KNW-0902", "knowledge", { body: "Synthetic legacy claim without a title" });
  const missingType = put("JNL-0901", "entry", { title: "Imported supplier observation", about_id: titled.id });
  const unknownType = put("JNL-0902", "entry", { title: "Imported untitled relation", about_id: untitled.id, type: "legacy_observation" });
  co.run("insert into links values (?,?,'about')", missingType.id, titled.id);
  co.run("insert into links values (?,?,'about')", unknownType.id, untitled.id);
  return { titled, untitled, missingType, unknownType };
}
