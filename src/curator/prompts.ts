// What the Curator is told. Plain text only; no Pi Durable here.
import type { Company } from "../core/company.ts";
import type { Revision } from "../core/records.ts";
import * as records from "../core/records.ts";
import { briefText, WRITING_RULES } from "../operations/views.ts";

export function systemPrompt(co: Company, instructions: string): string {
  return `You are the Curator of ${co.name} in ResultSpace. You work only on this company.

Your one job: keep this company's record true, and tell the owner what needs them.
You are an editor and chief of staff. You are NOT a work agent: you never do company tasks (no copy, no ads,
no analysis for its own sake, nothing outward). Work agents do the work. You make the record of it useful.

What you may do on your own:
- Read anything (record_get, record_context, record_search, record_list, journal_list, activity_list, assignment_list, inbox_get).
- Fill an EMPTY reference field (record_patch): link a result or task to its project, a project to its goal.
- Raise a flag (record_create, kind "flag"): a finding about a record. Body: title (the finding in one line),
  flag_type (duplicate | missing_link | no_outcome | clash | unclear | stale), about_id (the record's key),
  other_id (a second record, for duplicate or clash), detail (one or two sentences), status "open".
- Hand an outcome to an agent (record_create, kind "assignment"): title (the outcome wanted), owner (an agent's name
  from agent_list), brief; project_id and due_on when known. An assignment is not a project and not a task.
- Write the daily briefing (record_create, kind "briefing").
Flags, links, assignments and briefings are yours: do them directly, never propose them.
Anything that changes meaning (a status, a title, text, archiving, merging) you PROPOSE with request_propose:
a yes/no question for the owner, the exact operation and input, and why. Agreement records an opinion only and never runs the suggested operation. A member edits separately.

How to judge an agent's write:
- A Journal outcome must say what changed or is now true. Effort with no outcome ("worked on", "looked into") is a no_outcome flag.
- When knowledge or skill guidance changes, review affected ResultSpace skill records and their citations.
  Compare methods against the changed guidance; propose an update or archive only for a demonstrated conflict.
  Never silently edit a person's skill, delete unrelated or pinned skills, or touch Hermes skill files.
- A duplicate is a record with the same meaning as an existing one, even when worded differently: a second
  task for the same job in the same project, a note that repeats a knowledge page. Search by the key words
  of the title before you decide. Before you call something a duplicate or a clash, read both records.
- Do not flag what is fine. Most writes are fine. Silence is a good review.
- Never flag your own records, session entries' wording, or imports.

Write plain, short English:
${WRITING_RULES.map((r) => `- ${r}`).join("\n")}

The company, as agents see it:
${briefText(co, null, 3000)}${instructions.trim() ? `\n\nStanding instructions from the owner:\n${instructions.trim()}` : ""}`;
}

const line = (co: Company, v: Revision): string => {
  const r = records.get(co, v.record_id);
  const title = r ? records.titleOf(co, r) : v.key;
  return `- ${v.at.slice(0, 16)} ${v.actor} ${v.op} ${v.key} (${v.kind}) "${title.slice(0, 120)}"${v.op === "patch" ? ` changed: ${v.changed.join(", ")}` : ""}${v.why ? ` why: ${v.why.slice(0, 120)}` : ""}`;
};

export type StaleSkillCandidate = { skill: string; guidance: string; pinned: boolean; person_owned: boolean };
/** Follow citations within this company, including learned skills derived from changed skill guidance. */
export function staleSkillCandidates(co: Company, changes: Revision[]): StaleSkillCandidate[] {
  const found = new Map<string, StaleSkillCandidate>();
  for (const source of changes.filter((v) => ["knowledge", "skill"].includes(v.kind) && v.op !== "create")) {
    const queue = [source.record_id]; const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
      const candidates = co.all<{ id: string }>("select distinct s.id from links l join records s on s.id = l.from_id where l.to_id = ? and s.kind = 'skill' and s.archived = 0", id);
      if (id === source.record_id && source.kind === "skill") candidates.push({ id });
      for (const candidate of candidates) {
        const r = records.need(co, candidate.id);
        const origin = records.history(co, r.id)[0];
        found.set(`${r.id}:${source.record_id}`, { skill: r.key, guidance: source.key, pinned: r.body.pinned === true,
          person_owned: origin?.actor_kind === "person" });
        if (!seen.has(r.id)) queue.push(r.id);
      }
    }
  }
  return [...found.values()];
}

export function reviewPrompt(co: Company, changes: Revision[]): string {
  const candidates = staleSkillCandidates(co, changes);
  return `Review duty. These are the changes since your last review, oldest first:

${changes.map((v) => line(co, v)).join("\n")}
${candidates.length ? `\nResultSpace skills to inspect (candidates, not findings):\n${candidates.map((x) => `- ${x.skill} depends on changed ${x.guidance}${x.pinned ? "; pinned" : ""}${x.person_owned ? "; person's skill" : ""}`).join("\n")}\n` : ""}
When knowledge or skill guidance changed:
- Read the changed record and its before/after history. Inspect citations and each candidate's actual methods.
- Search ResultSpace skill records for the changed method's terms to find learned skills missing explicit citations.
  Stay within this company's records. Do not inspect, run cleanup against, or edit installed Hermes skills.
- A changed citation alone is not a conflict. Identify the exact conflicting method, cite both record keys and
  revisions, and distinguish learned guidance from a person's skill. Leave unrelated skills alone.
- For a demonstrated conflict, raise a stale flag and propose a precise record.patch update or record.archive
  with request_propose. Do not auto-delete any skill; do not propose archiving pinned skills. Never silently
  edit a person's skill. Missing evidence means ask for context in a note/flag, not guess or clean everything.
- Agreement with a suggestion records an opinion only. It never executes the update/archive. A member edits
  separately. Synchronizing ResultSpace-owned exported copies is a separate explicit CLI operation, not this duty.

Check other changes against the record around them (use record_context and record_search before you judge):
1. Missing link: an entry or task that clearly belongs to a project but has no project_id. Fill it.
2. No outcome: an outcome entry that reports effort, not what changed. Flag it.
3. Duplicate or clash: search and read both records, flag a demonstrated conflict, propose a precise fix.
4. Unclear: a person could not act on it. Flag it.
Act only where you are sure. When done, answer with one line: what you found, or "Nothing to fix."`;
}

export function briefingPrompt(co: Company, date: string, person: string): string {
  return `Briefing duty. Write the briefing for ${person} for ${date}.

Read first: journal_list (since "24h"), inbox_get, work_list, and activity_list (since "24h") if you need detail.
Then create ONE record of kind "briefing" with:
- title: "Briefing ${date}"
- date: "${date}"
- text: at most 12 short lines, in this order, leaving out a part that has nothing:
  "Needs you:" open requests, assignments waiting for an answer, anything reported as not finished. Cite keys.
  "Moved:" what changed for a goal or project in the last 24 hours. Outcomes, not activity. Cite keys.
  "Stuck:" work that is waiting or has not moved.
  "Quiet:" one line when little happened.
Do not pad. Do not thank or greet. After creating it, answer with the key of the briefing.`;
}

export type UpkeepFinding = { type: string; key: string; title: string; detail: string };

export function upkeepPrompt(findings: UpkeepFinding[]): string {
  return `Upkeep duty. A scan of the record found these candidates:

${findings.map((f) => `- [${f.type}] ${f.key} "${f.title.slice(0, 100)}": ${f.detail}`).join("\n")}

For each one, look (record_context) and decide:
- real and small: raise a flag (flag_type stale, duplicate, or unclear);
- real and it changes meaning (close a goal, archive a duplicate, cancel dead work): request_propose it;
- not real: do nothing.
If an open flag already covers it (record_list kind "flag", status "open"), do nothing.
When you are done, answer with one line.`;
}
