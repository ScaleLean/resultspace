// One skill: its SKILL.md rendered, the knowledge it depends on, and (later) what uses it.
import { need } from "#lib/server/rs.ts";
import { frontMatter, md } from "#lib/md.ts";
import type { SkillItem } from "../../../../../../src/operations/skills.ts";
import type { PageServerLoad } from "./$types";

type Shown = { key: string; company: string; shared: boolean; markdown: string; rev: number };

export const load: PageServerLoad = ({ locals, params, url }) => {
  // ?shared=1: a skill from the shared company, which may have the same key as one of ours.
  const shared = url.searchParams.get("shared") === "1";
  const shown = need(locals.rs.run<Shown>(params.slug, "skill.show", { ref: params.key, shared }));
  // The list carries the title, status, when-to-use and the knowledge keys; skill.show carries the text.
  const item = need(locals.rs.run<SkillItem[]>(params.slug, "skill.list", {})).find((s) => s.key === shown.key && s.shared === shown.shared);
  const { meta, body } = frontMatter(shown.markdown);
  return {
    key: shown.key, company: shown.company, shared: shown.shared, rev: shown.rev,
    title: item?.title ?? meta.description ?? shown.key, status: item?.status ?? "", when: item?.when ?? "",
    knowledge: item?.knowledge ?? [], updated_at: item?.updated_at ?? null,
    // The file repeats the title as its first heading and the knowledge as its last line; the page shows both itself.
    html: md(body.replace(/^\s*# [^\n]*\n+/, "").replace(/\n\nKnowledge this skill depends on:[^\n]*\n?$/, "")),
  };
};
