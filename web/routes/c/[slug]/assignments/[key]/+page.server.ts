import { fail_of, need, str } from "#lib/server/rs.ts";
import type { Assignment } from "../../../../../../src/operations/assignments.ts";
import type { Actions, PageServerLoad } from "./$types";

import type { Assertion, AssertionContext } from "../../../../../../src/core/records.ts";

type Linked = { key: string; title: string; at: string; by: string; phase: string | null; assertion?: Assertion; assertion_context?: AssertionContext; organizational_assignment: string | null };
export type AssignmentPage = Assignment & { outcomes: Linked[]; sessions: Linked[]; actions: Linked[]; notes: Linked[] };

// Old WO- keys and new ASG- keys both resolve here.
export const load: PageServerLoad = ({ locals, params }) => ({ assignment: need(locals.rs.run<AssignmentPage>(params.slug, "assignment.show", { ref: params.key })) });

export const actions: Actions = {
  // Append context about a blocker; no authorization or state change.
  answer: async ({ request, locals, params }) => {
    const answer = str(await request.formData(), "answer");
    if (!answer) return fail_of({ ok: false, error: "Write your answer first." });
    const r = locals.rs.run(params.slug, "assignment.answer", { ref: params.key, answer });
    if (!r.ok) return fail_of(r, { answer });
    return { done: "Answer sent." };
  },
  // Cancel an unfinished assignment (optional reason).
  cancel: async ({ request, locals, params }) => {
    const why = str(await request.formData(), "why");
    const r = locals.rs.run(params.slug, "assignment.cancel", { ref: params.key, ...(why ? { why } : {}) });
    if (!r.ok) return fail_of(r, { why });
    return { done: "Assignment cancelled." };
  },
  review: async ({ request, locals, params }) => {
    const note = str(await request.formData(), "note");
    if (!note) return fail_of({ ok: false, error: "Write a review note first." });
    const r = locals.rs.run(params.slug, "assignment.review", { ref: params.key, note });
    if (!r.ok) return fail_of(r, { note });
    return { done: "Review note recorded." };
  },
};
