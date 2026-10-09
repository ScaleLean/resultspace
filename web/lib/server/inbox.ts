// The three things a person does with what waits for them, shared by the home page (any company: the form
// carries `slug`) and a company's Overview (the company in the URL):
//   decide  approve or decline a request      <button name="approve" value="yes|no">
//   answer  answer an assignment that waits    <textarea name="answer">
//   flag    close a flag                       <button name="status" value="fixed|dismissed">
// Each form also sends <input name="key">.
import type { WebService } from "../../../src/web/service.ts";
import { fail_of, str } from "./rs.ts";

const FLAG_STATUS = ["dismissed", "fixed"];

export function decide(rs: WebService, slug: string, form: FormData) {
  const key = str(form, "key");
  const approve = str(form, "approve") === "yes";
  const r = rs.run(slug, "request.decide", { ref: key, approve });
  if (!r.ok) return fail_of(r, { key });
  return { done: approve ? `Approved ${key}.` : `Declined ${key}.` };
}

export function answer(rs: WebService, slug: string, form: FormData) {
  const key = str(form, "key");
  const text = str(form, "answer");
  if (!text) return fail_of({ ok: false, error: "Write your answer first." }, { key });
  const r = rs.run(slug, "assignment.answer", { ref: key, answer: text });
  if (!r.ok) return fail_of(r, { key, answer: text });
  return { done: `Answered ${key}. The agent can go on.` };
}

export function flag(rs: WebService, slug: string, form: FormData) {
  const key = str(form, "key");
  const status = str(form, "status");
  if (!FLAG_STATUS.includes(status)) return fail_of({ ok: false, error: "Choose Dismiss or Fixed." }, { key });
  const r = rs.run(slug, "record.patch", { ref: key, set: { status }, why: `${status} by a person` });
  if (!r.ok) return fail_of(r, { key });
  return { done: status === "fixed" ? `Marked ${key} as fixed.` : `Dismissed ${key}.` };
}
