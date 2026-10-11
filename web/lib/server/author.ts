import { invalid } from "../../../src/core/errors.ts";
import type { Body } from "../../../src/core/records.ts";
import { str } from "./rs.ts";
const refs = (s: string) => s.split(/[\s,]+/).filter(Boolean);
export function authorBody(f: FormData, kind: string): Body {
  const body: Body = { title: str(f, "title") };
  const fields: Record<string, string[]> = {
    project: ["goal", "current_state", "status"],
    fact: ["subject", "predicate", "value_type", "scope", "unit", "observed_at", "source", "project_id"],
    knowledge: ["body", "source", "project_id"],
    issue_note: ["detail", "status", "project_id"],
    entry: ["detail", "type", "source", "project_id"],
    source: ["url", "detail"],
    flag: ["detail", "status", "suggestion"],
    briefing: ["text"],
    decision: ["choice", "source", "project_id"],
    artifact: ["title"],
    company: ["name", "brief"],
  };
  for (const k of fields[kind] ?? []) if (f.has(k)) body[k] = str(f, k) || null;
  if (kind === "project" && f.has("objectives"))
    body.objectives = str(f, "objectives")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  for (const k of ["source_ids", ...(kind === "project" ? ["fact_ids", "knowledge_ids"] : [])]) if (f.has(k)) body[k] = refs(str(f, k));
  if (kind === "fact") {
    const v = str(f, "value");
    const t = str(f, "value_type");
    if (t === "number" && (!v || !Number.isFinite(Number(v)))) throw invalid("Enter a finite numeric value");
    if (t === "boolean" && !["true", "false"].includes(v)) throw invalid("Boolean value must be true or false");
    body.value = t === "number" ? Number(v) : t === "boolean" ? v === "true" : v;
  }
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}
