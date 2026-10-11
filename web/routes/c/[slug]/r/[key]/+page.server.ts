import { need, fail_of, str } from "#lib/server/rs.ts";
import { authorBody } from "#lib/server/author.ts";
import type { Rec, Revision, Link, provenance, projectScope } from "../../../../../../src/core/records.ts";
import type { ProjectContext } from "../../../../../../src/core/context.ts";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = ({ locals, params }) => {
  const ctx = need(
    locals.rs.run<ReturnType<typeof provenance> & { project_scope: ReturnType<typeof projectScope>; record: Rec; legacy: boolean; links: { out: Link[]; in: Link[] } }>(params.slug, "record.context", { ref: params.key }),
  );
  return {
    ...ctx,
    history: need(locals.rs.run<Revision[]>(params.slug, "record.history", { ref: params.key })),
    project:
      ctx.record.kind === "project" ? need(locals.rs.run<ProjectContext>(params.slug, "project.context", { ref: params.key })) : null,
  };
};
export const actions: Actions = {
  patch: async ({ locals, params, request }) => {
    const f = await request.formData();
    const current = need(locals.rs.run<Rec>(params.slug, "record.get", { ref: params.key }));
    let set;
    try {
      set = authorBody(f, current.kind);
    } catch (e) {
      return fail_of({ ok: false, error: e instanceof Error ? e.message : "Invalid input" });
    }
    const r = locals.rs.run(params.slug, "record.patch", { ref: params.key, set, base_rev: Number(str(f, "rev")), why: str(f, "why") });
    return r.ok ? { saved: "Saved with history." } : fail_of(r);
  },
  archive: ({ locals, params }) => {
    const r = locals.rs.run(params.slug, "record.archive", { ref: params.key });
    return r.ok ? { saved: "Archived." } : fail_of(r);
  },
  restore: ({ locals, params }) => {
    const r = locals.rs.run(params.slug, "record.restore", { ref: params.key });
    return r.ok ? { saved: "Restored." } : fail_of(r);
  },
  undo: async ({ locals, params, request }) => {
    const r = locals.rs.run(params.slug, "record.undo", { ref: params.key, rev: Number(str(await request.formData(), "rev")) });
    return r.ok ? { saved: "Undone; history preserved." } : fail_of(r);
  },
};
