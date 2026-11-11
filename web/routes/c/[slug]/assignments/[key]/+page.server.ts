import { fail_of, need, str } from "#lib/server/rs.ts";
import type { Assignment } from "../../../../../../src/operations/assignments.ts";
import type { Actions, PageServerLoad } from "./$types";

type Linked = { key: string; title: string; at: string; by: string };
export type AssignmentPage = Assignment & { outcomes: Linked[]; sessions: Linked[]; actions: Linked[] };

// Old WO- keys and new ASG- keys both resolve here.
export const load: PageServerLoad = ({ locals, params }) => ({ assignment: need(locals.rs.run<AssignmentPage>(params.slug, "assignment.show", { ref: params.key })) });

export const actions: Actions = {
  // Answer an assignment that waits for permission.
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
  // A person says whether the reported result holds up. The reporter cannot verify their own result.
  verify: async ({ request, locals, params }) => {
    const form = await request.formData();
    const verdict = str(form, "verdict"), note = str(form, "note");
    if (verdict !== "verified" && verdict !== "disputed") return fail_of({ ok: false, error: "Choose Verified or Disputed." });
    const r = locals.rs.run(params.slug, "assignment.verify", { ref: params.key, verdict, ...(note ? { note } : {}) });
    if (!r.ok) return fail_of(r, { note });
    return { done: verdict === "verified" ? "Marked as verified." : "Marked as disputed." };
  },
};
