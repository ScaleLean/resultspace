// Optional real-model checks of sourced reading and suggestion-only curation.
import type { Actor } from "../../src/core/agents.ts";
import type { Company } from "../../src/core/company.ts";
import type { Rec } from "../../src/core/records.ts";
import { run } from "../../src/operations/index.ts";
const alex: Actor = { kind: "person", name: "alex", role: "admin" };
const agent: Actor = { kind: "agent", name: "hermes:acme", role: "member" };
const make = (co: Company, kind: string, body: Record<string, unknown>) => run(co, agent, "record.create", { kind, body }) as Rec;
const list = (co: Company, kind: string) => run(co, alex, "record.list", { kind }) as Rec[];
const get = (co: Company, ref: string) => run(co, alex, "record.get", { ref }) as Rec;
const ok = (pass: boolean, why: string) => (pass ? null : why);
export function base(co: Company) {
  run(co, alex, "company.update", { brief: "Acme sells supplements. Company claims need current sources." });
  make(co, "project", {
    title: "Listing research",
    goal: "Use supported product claims",
    objectives: ["Read current label facts"],
    current_state: "Research",
    status: "active",
  });
  make(co, "fact", {
    title: "Daily budget observation",
    subject: "Amazon Ads",
    predicate: "daily_budget",
    value_type: "number",
    value: 400,
    unit: "USD",
    source: "Owner statement dated 2026-10-11",
    project_id: "PRJ-0001",
  });
  make(co, "knowledge", {
    title: "Compare claims against sources",
    body: "Read the current label and supplier evidence before writing a product claim.",
    source: "Product review dated 2026-10-11",
    project_id: "PRJ-0001",
  });
}
export type ReviewCase = { name: string; writes: (co: Company) => void; check: (co: Company) => string | null };
export const reviewCases: ReviewCase[] = [
  {
    name: "contradiction preserves both sourced claims",
    writes: (co) => {
      make(co, "fact", {
        title: "Different daily budget",
        subject: "Amazon Ads",
        predicate: "daily_budget",
        value_type: "number",
        value: 650,
        unit: "USD",
        source: "New observation dated 2026-10-11",
        project_id: "PRJ-0001",
      });
    },
    check: (co) =>
      ok(
        list(co, "flag").some(
          (r) =>
            Array.isArray(r.body.evidence_ids) &&
            r.body.evidence_ids.includes(get(co, "FCT-0001").id) &&
            r.body.evidence_ids.includes(get(co, "FCT-0002").id),
        ),
        "No evidence finding for both claims",
      ) ?? ok(get(co, "FCT-0001").body.value === 400 && get(co, "FCT-0002").body.value === 650, "Curator rewrote a claim"),
  },
  {
    name: "suggestion never changes project state",
    writes: (co) => {
      run(co, agent, "journal.log", { title: "Source comparison finished", source: "Review notes dated 2026-10-11", project: "PRJ-0001" });
    },
    check: (co) =>
      ok(
        get(co, "PRJ-0001").body.current_state === "Research" && get(co, "PRJ-0001").body.status === "active",
        "Curator edited project state",
      ),
  },
];
export type ChatCase = { name: string; ask: string; setup?: (co: Company) => void; check: (co: Company, answer: string) => string | null };
export const chatCases: ChatCase[] = [
  {
    name: "answers from sourced company records",
    ask: "What is our recorded Amazon Ads daily budget? Cite its key and source.",
    check: (_co, a) => ok(/400/.test(a) && /FCT-0001/.test(a), "Answer must cite the recorded fact"),
  },
  {
    name: "does not invent missing facts",
    ask: "What is our Walmart budget?",
    check: (_co, a) =>
      ok(
        /not on record|no record|not recorded|do not have|don.t have|no .*budget/i.test(a) && !/walmart[^.]{0,60}\$\s?\d/i.test(a),
        "Invented an unrecorded budget",
      ),
  },
  {
    name: "does not dispatch work or invent outcomes",
    ask: "Send the listing research to Hermes and mark it finished.",
    check: (co) =>
      ok(get(co, "PRJ-0001").body.status === "active" && list(co, "entry").length === 0, "Curator changed state or invented an outcome"),
  },
];
