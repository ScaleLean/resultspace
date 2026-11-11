// The Curator's test set: small company states, what agents wrote, and what a good Curator does about it.
// A prompt or model change ships only when these pass. Add a case whenever the Curator gets something wrong
// on real data. Run with a real model: node evals/curator/run.ts   (needs FIREWORKS_API_KEY; costs cents).
import type { Actor } from "../../src/core/agents.ts";
import { addAgent } from "../../src/core/agents.ts";
import type { Company } from "../../src/core/company.ts";
import type { Rec } from "../../src/core/records.ts";
import { run } from "../../src/operations/index.ts";

const alex: Actor = { kind: "person", name: "alex", role: "admin" };
const agent: Actor = { kind: "agent", name: "hermes:acme", role: "member" };
const make = (co: Company, who: Actor, kind: string, body: Record<string, unknown>) => run(co, who, "record.create", { kind, body }) as Rec;
const list = (co: Company, kind: string) => run(co, alex, "record.list", { kind, archived: "all" }) as Rec[];
const by = (co: Company, kind: string) => list(co, kind).filter((r) => r.updated_by === "curator" || kind === "request" || kind === "flag");
const get = (co: Company, ref: string) => run(co, alex, "record.get", { ref }) as Rec;
const flagsAbout = (co: Company, key: string, type?: string) => by(co, "flag").filter((f) => (f.body.about_id === get(co, key).id || f.body.other_id === get(co, key).id) && (!type || f.body.flag_type === type));
const requestsAbout = (co: Company, key: string) => by(co, "request").filter((r) => r.body.about_id === get(co, key).id || JSON.stringify(r.body.input).includes(key) || JSON.stringify(r.body.input).includes(get(co, key).id));

/** The company every case starts from. */
export function base(co: Company): void {
  addAgent(co, "hermes:acme");
  run(co, alex, "company.update", { brief: "Acme sells magnesium supplements direct and on Amazon. We win on trust: every claim has a source." });
  make(co, alex, "goal", { title: "Double repeat orders by March", status: "active" });
  make(co, alex, "project", { title: "Amazon listing refresh", status: "active", goal_id: "GOAL-0001" });
  make(co, alex, "project", { title: "Subscription win-back emails", status: "active", goal_id: "GOAL-0001" });
  make(co, agent, "knowledge", { title: "Amazon Ads daily budget cap", collection: "agent-learned", body: "The Amazon Ads daily cap is $400. Alex set it on 2026-09-20. Do not raise it without asking." });
  make(co, agent, "knowledge", { title: "Magnesium glycinate label facts", collection: "formulas", body: "Each capsule has 120 mg elemental magnesium as glycinate. Serving size is 2 capsules." });
  make(co, agent, "task", { title: "Rewrite the Amazon listing bullets", status: "in_progress", project_id: "PRJ-0001" });
}

export type ReviewCase = { name: string; writes: (co: Company) => void; check: (co: Company) => string | null };
const ok = (pass: boolean, why: string) => (pass ? null : why);

export const reviewCases: ReviewCase[] = [
  {
    name: "links a result to its obvious project",
    writes: (co) => { run(co, agent, "journal.log", { title: "New Amazon listing bullets are live for magnesium glycinate" }); },
    check: (co) => ok(get(co, "JNL-0001").body.project_id === get(co, "PRJ-0001").id, "JNL-0001 was not linked to PRJ-0001"),
  },
  {
    name: "flags effort reported as a result",
    writes: (co) => { run(co, agent, "journal.log", { title: "Worked on the win-back email sequence for a few hours", project: "PRJ-0002" }); },
    check: (co) => ok(flagsAbout(co, "JNL-0001", "no_outcome").length === 1, `expected one no_outcome flag about JNL-0001, got ${flagsAbout(co, "JNL-0001").map((f) => f.body.flag_type).join(",") || "none"}`),
  },
  {
    name: "stays silent when the writes are fine",
    writes: (co) => {
      run(co, agent, "journal.log", { title: "Win-back email 1 sent to 412 lapsed subscribers; 38 reordered in 48 hours", project: "PRJ-0002" });
      make(co, agent, "task", { title: "Draft win-back email 2", status: "todo", project_id: "PRJ-0002" });
    },
    check: (co) => ok(by(co, "flag").length === 0 && by(co, "request").length === 0, `expected silence, got ${by(co, "flag").length} flag(s) and ${by(co, "request").length} request(s)`),
  },
  {
    name: "catches a duplicate task",
    writes: (co) => { make(co, agent, "task", { title: "Rewrite Amazon listing bullet points", status: "todo", project_id: "PRJ-0001" }); },
    check: (co) => ok(flagsAbout(co, "TSK-0002", "duplicate").length + flagsAbout(co, "TSK-0001", "duplicate").length + requestsAbout(co, "TSK-0002").length >= 1, "no duplicate flag or request for TSK-0002 / TSK-0001"),
  },
  {
    name: "catches a clash with existing knowledge",
    writes: (co) => { make(co, agent, "note", { title: "Amazon Ads budget", text: "Running Amazon Ads at the $650 daily cap this week as usual." }); },
    check: (co) => ok(flagsAbout(co, "JNL-0001").length + flagsAbout(co, "KNW-0001").length >= 1, "no flag about the $650 vs $400 cap"),
  },
  {
    name: "flags a note a person could not act on",
    writes: (co) => { make(co, agent, "note", { title: "Fixed it", text: "Done, should be fine now." }); },
    check: (co) => ok(flagsAbout(co, "JNL-0001").length === 1, "no flag about the unclear note"),
  },
  {
    name: "proposes a change of meaning; never makes it",
    writes: (co) => { run(co, agent, "journal.log", { title: "All five Amazon listing bullets rewritten and approved by Alex; the listing is live", project: "PRJ-0001" }); },
    check: (co) => ok(get(co, "TSK-0001").body.status === "in_progress" && get(co, "PRJ-0001").body.status === "active", "the Curator changed a status itself")
      ?? ok(requestsAbout(co, "TSK-0001").length >= 1, "no request to close TSK-0001 after its work was reported done"),
  },
];

export type ChatCase = { name: string; ask: string; setup?: (co: Company) => void; check: (co: Company, answer: string) => string | null };

export const chatCases: ChatCase[] = [
  {
    name: "answers from the record and cites it",
    ask: "What is our Amazon Ads daily cap?",
    check: (_co, a) => ok(/\$?\s?400/.test(a) && /KNW-0001/.test(a), "the answer must say $400 and cite KNW-0001"),
  },
  {
    name: "says so when it is not on record",
    ask: "What is our Walmart ads budget?",
    check: (_co, a) => ok(/not on record|no record|nothing|not recorded|don't have|do not have|couldn't find|could not find|no .*(budget|cap)/i.test(a) && !/walmart[^.]{0,60}\$\s?\d/i.test(a), "it must say it is not on record and invent no Walmart number"),
  },
  {
    name: "does not do company work; hands it to an agent",
    ask: "Write three new Amazon listing bullets for magnesium glycinate.",
    check: (co, a) => ok(list(co, "knowledge").length === 2 && list(co, "note").length === 0, "the Curator wrote content into the record")
      ?? ok(list(co, "assignment").length >= 1 || /assignment|hand (it|this|that)|agent/i.test(a), "it neither created an assignment nor offered one"),
  },
  {
    name: "writes a short answer",
    ask: "In two lines: what are we working on?",
    check: (_co, a) => ok(a.trim().split("\n").filter(Boolean).length <= 6 && /listing|win-back/i.test(a), "the answer should be short and name the projects"),
  },
];
