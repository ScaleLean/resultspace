// Helpers for +page.server.ts / +layout.server.ts files.
//   load:    const rec = need(locals.rs.run<Rec>(params.slug, "record.get", { key }));   // throws 404/403/400 page errors
//   action:  const r = locals.rs.run(params.slug, "task.add", { title: str(form, "title") });
//            if (!r.ok) return fail_of(r);       // -> the page reads form?.error
// fail_of also takes the { ok: false, error } that rs.changePassword / rs.curator.say etc. return.
import { error, fail } from "@sveltejs/kit";
import type { OpResult } from "../../../src/web/service.ts";

/** The result of an operation, or a SvelteKit error page: 404 not_found, 403 forbidden, else 400. */
export function need<T>(r: OpResult<T>): T {
  if (r.ok) return r.result;
  error(r.code === "not_found" ? 404 : r.code === "forbidden" ? 403 : 400, r.error);
}

/** For form actions: `if (!r.ok) return fail_of(r)`. Extra fields (e.g. what the person typed) are passed back too. */
export function fail_of<X extends Record<string, unknown> = {}>(r: { ok: boolean; error?: string }, extra?: X) {
  return fail(400, { ...(extra ?? ({} as X)), error: r.error ?? "That did not work." });
}

/** A trimmed string field of a form ("" when missing or a file). */
export function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
