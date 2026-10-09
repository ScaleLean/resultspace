// Skills: how we do things. A skill cites the knowledge it depends on (knowledge_ids), so when that knowledge
// changes the Curator checks the skill. Skills in the shared company are readable with ANY key: this is the
// one deliberate exception to "a key sees one company", limited to skills, so every agent can find them.
import { Type } from "typebox";
import type { Company } from "../core/company.ts";
import { notFound } from "../core/errors.ts";
import * as records from "../core/records.ts";
import { Limit, op, Ref, type Operation } from "./define.ts";

let shared: (() => Company | undefined) | undefined;
/** Tell the operations which company holds the skills every agent may read. */
export function setSharedCompany(get: () => Company | undefined): void { shared = get; }

export type SkillItem = { key: string; title: string; status: string; when: string; company: string; shared: boolean; knowledge: { key: string; title: string }[]; updated_at: string };

const item = (co: Company, r: records.Rec, isShared: boolean): SkillItem => ({
  key: r.key, title: records.titleOf(co, r), status: String(r.body.status ?? "draft"), when: typeof r.body.when === "string" ? r.body.when : "",
  company: co.slug, shared: isShared, updated_at: r.updated_at,
  knowledge: (Array.isArray(r.body.knowledge_ids) ? (r.body.knowledge_ids as unknown[]) : []).flatMap((id) => { const k = typeof id === "string" ? records.get(co, id) : undefined; return k ? [{ key: k.key, title: records.titleOf(co, k) }] : []; }),
});

/** A skill as a SKILL.md file: front matter the agent runtimes read, then the body. */
export function skillMarkdown(co: Company, r: records.Rec, isShared: boolean): string {
  const s = item(co, r, isShared);
  const head = [`name: ${r.key.toLowerCase()}`, `description: ${s.title}${s.when ? `. Use when: ${s.when}` : ""}`, `source: resultspace ${co.slug} ${r.key} rev ${r.rev}`];
  const cites = s.knowledge.length ? `\n\nKnowledge this skill depends on: ${s.knowledge.map((k) => `${k.key} (${k.title})`).join(", ")}.` : "";
  return `---\n${head.join("\n")}\n---\n\n# ${s.title}\n\n${typeof r.body.body === "string" ? r.body.body.trim() : ""}${cites}\n`;
}

function all(co: Company, o: { status?: string | undefined; limit?: number | undefined }): SkillItem[] {
  const own = records.list(co, { kind: "skill", status: o.status, limit: o.limit ?? 200 }).map((r) => item(co, r, false));
  const sh = shared?.();
  const extra = sh && sh.slug !== co.slug ? records.list(sh, { kind: "skill", status: o.status, limit: o.limit ?? 200 }).map((r) => item(sh, r, true)) : [];
  return [...own, ...extra];
}

export const skillOperations: Operation[] = [
  op({
    name: "skill.list", summary: "Skills this company's agents can use: its own and the shared ones", role: "viewer", write: false,
    input: Type.Object({ status: Type.Optional(Type.String()), q: Type.Optional(Type.String({ maxLength: 200, description: "Words to look for in title and when-to-use" })), limit: Limit(500) }),
    run: (ctx, i) => {
      const words = (i.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return all(ctx.company, i).filter((s) => words.every((w) => `${s.title} ${s.when}`.toLowerCase().includes(w)));
    },
  }),
  op({
    name: "skill.show", summary: "One skill as a SKILL.md file (this company's, or with `shared`, one from the shared company)", role: "viewer", write: false,
    input: Type.Object({ ref: Ref, shared: Type.Optional(Type.Boolean({ description: "Look in the shared company (keys count per company, so a shared skill may have the same key as one of ours)" })) }),
    run: (ctx, i) => {
      const own = i.shared ? undefined : records.get(ctx.company, i.ref);
      if (own?.kind === "skill") return { key: own.key, company: ctx.company.slug, shared: false, markdown: skillMarkdown(ctx.company, own, false), rev: own.rev };
      const sh = shared?.();
      const r = sh && sh.slug !== ctx.company.slug ? records.get(sh, i.ref) : undefined;
      if (r?.kind === "skill") return { key: r.key, company: sh!.slug, shared: true, markdown: skillMarkdown(sh!, r, true), rev: r.rev };
      throw notFound(`skill ${i.ref}`);
    },
  }),
];
