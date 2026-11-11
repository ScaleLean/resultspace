import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { syncSkills, enumerateSkills, type ExportedSkill } from "../src/cli/skill-sync.ts";
import { staleSkillCandidates, reviewPrompt } from "../src/curator/prompts.ts";
import { create, patch, history } from "../src/core/records.ts";
import { run } from "../src/operations/index.ts";
import { admin, member, setup } from "./helpers.ts";
import type { SkillItem } from "../src/operations/skills.ts";

const skill = (company: string, key: string, markdown: string, pinned = false): ExportedSkill => ({ company, key, markdown, pinned });

test("skill sync previews, uniquely names sources, backs up changes and archives only owned unchanged copies", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "rs-skills-")); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "exports"); const a = skill("acme", "SKL-0001", "owned one");
  const desired = [a, skill("shared", "SKL-0001", "shared one"), skill("shared", "SKL-0002", "shared two"), skill("acme", "SKL-0002", "pinned remote", true)];
  assert.equal(syncSkills(root, "acme", desired, true).plan.length, 4);
  assert.equal(existsSync(root), false, "preview writes nothing");
  const first = syncSkills(root, "acme", desired);
  assert.equal(first.written.length, 4);
  assert.equal(readFileSync(join(root, "shared-skl-0001/SKILL.md"), "utf8"), "shared one");
  assert.equal(readFileSync(join(root, "shared-skl-0002/SKILL.md"), "utf8"), "shared two");
  writeFileSync(join(root, "acme-skl-0001/SKILL.md"), "local edited guidance");
  writeFileSync(join(root, "shared-skl-0001/user-notes.txt"), "do not remove");
  mkdirSync(join(root, "unrelated")); writeFileSync(join(root, "unrelated/SKILL.md"), "person skill");
  mkdirSync(join(root, "shared")); writeFileSync(join(root, "shared/SKILL.md"), "old unmanaged export");
  const preview = syncSkills(root, "acme", [], true);
  assert.deepEqual(preview.protected.map((x) => x.reason).sort(), ["local edits", "pinned"]);
  assert.equal(existsSync(join(root, "shared-skl-0001/SKILL.md")), true);
  const archived = syncSkills(root, "acme", []);
  assert.equal(archived.archived.length, 2);
  assert.equal(existsSync(join(root, "shared-skl-0001/SKILL.md")), false);
  assert.equal(readFileSync(join(archived.backup!, "shared-skl-0001/SKILL.md"), "utf8"), "shared one");
  assert.equal(readFileSync(join(root, "shared-skl-0001/user-notes.txt"), "utf8"), "do not remove");
  for (const file of ["acme-skl-0001/SKILL.md", "acme-skl-0002/SKILL.md", "unrelated/SKILL.md", "shared/SKILL.md"]) assert.ok(existsSync(join(root, file)));
  const updated = syncSkills(root, "acme", [skill("shared", "SKL-0003", "old")]);
  const update = syncSkills(root, "acme", [skill("shared", "SKL-0003", "new")]);
  assert.equal(update.written.length, 1);
  assert.equal(readFileSync(join(update.backup!, "shared-skl-0003/SKILL.md"), "utf8"), "old");
  assert.ok(updated.manifest);
});

test("skill sync protects unmanaged matches, local pins, malformed manifests and symlinks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "rs-skills-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "acme-skl-0001")); writeFileSync(join(root, "acme-skl-0001/SKILL.md"), "user owned");
  const r = syncSkills(root, "acme", [skill("acme", "SKL-0001", "replacement"), skill("acme", "SKL-0002", "---\npinned: true\n---\nlocal pin")]);
  assert.equal(r.protected[0]!.reason, "user-owned or unmanaged");
  const next = syncSkills(root, "acme", []); assert.ok(next.protected.some((x) => x.reason === "pinned"));
  assert.equal(readFileSync(join(root, "acme-skl-0001/SKILL.md"), "utf8"), "user owned");
  symlinkSync(join(root, "acme-skl-0001"), join(root, "acme-skl-0003"));
  assert.throws(() => syncSkills(root, "acme", [skill("acme", "SKL-0003", "no")]), /symlink/);
  writeFileSync(join(root, ".resultspace-sync-acme.json"), JSON.stringify({ version: 1, company: "acme", files: [{ path: "../../SKILL.md", company: "acme", key: "SKL-0001", hash: "a".repeat(64), pinned: false }] }));
  assert.throws(() => syncSkills(root, "acme", []), /ownership entry/);
});

test("skill enumeration paginates beyond default/maximum pages without silently losing later active guidance", async (t) => {
  const { acme } = setup(t);
  acme.tx(() => { for (let n = 0; n < 505; n++) create(acme, member, "skill", { title: `Skill ${n}`, status: "active", body: "Method" }); });
  const active = await enumerateSkills(async (scope, after) => scope === "shared" ? [] : run(acme, member, "skill.list", { status: "active", scope, limit: 500, ...(after ? { after } : {}) }) as SkillItem[]);
  assert.equal(active.length, 505); assert.equal(new Set(active.map((r) => r.key)).size, 505);
  await assert.rejects(enumerateSkills(async () => [active[0]!, { ...active[1]!, cursor: "" }]), /pagination/);
});

test("stale guidance prompt follows company citations and learned derivatives, proposing edits without executing", (t) => {
  const { acme, other } = setup(t);
  const knowledge = create(acme, member, "knowledge", { title: "Method guidance", body: "Old method" });
  const base = create(acme, member, "skill", { title: "Base method", status: "active", body: "Old method", knowledge_ids: [knowledge.id] });
  const learned = create(acme, member, "skill", { title: "Learned method", status: "active", body: "Old method", skill_ids: [base.id], learned: true });
  const person = create(acme, admin, "skill", { title: "Person method", status: "active", body: "Old method", knowledge_ids: [knowledge.id], pinned: true });
  const unrelated = create(acme, member, "skill", { title: "Other method", status: "active", body: "Different method" });
  create(other, member, "skill", { title: "Other company method", status: "active", body: "Old method" });
  patch(acme, member, knowledge.key, { body: "New method" });
  const changes = [history(acme, knowledge.id).at(-1)!];
  const candidates = staleSkillCandidates(acme, changes);
  assert.deepEqual(candidates.map((x) => x.skill).sort(), [base.key, learned.key, person.key].sort());
  assert.equal(candidates.find((x) => x.skill === person.key)!.person_owned, true);
  assert.equal(candidates.find((x) => x.skill === person.key)!.pinned, true);
  const prompt = reviewPrompt(acme, changes);
  assert.match(prompt, /Do not auto-delete any skill/); assert.match(prompt, /do not propose archiving pinned skills/);
  assert.match(prompt, /Never silently\n  edit a person's skill/); assert.match(prompt, /Do not inspect, run cleanup against, or edit installed Hermes skills/);
  assert.match(prompt, /Search ResultSpace skill records/); assert.match(prompt, /never executes the update\/archive/);
  const curator = { kind: "curator", name: "curator", role: "member" } as const;
  const proposal = run(acme, curator, "request.propose", { title: "Update learned method?", operation: "record.patch", input: { ref: learned.key, set: { body: "New method" } }, why: `${knowledge.key} changed` }) as { key: string };
  run(acme, member, "request.decide", { ref: proposal.key, approve: true });
  assert.equal((run(acme, member, "record.get", { ref: learned.key }) as { body: { body: string } }).body.body, "Old method");
  assert.throws(() => run(acme, curator, "record.patch", { ref: person.key, set: { body: "New method" } }), /propose/);
  patch(acme, member, base.key, { body: "Changed base method" });
  assert.ok(staleSkillCandidates(acme, [history(acme, base.id).at(-1)!]).some((x) => x.skill === learned.key));
  assert.ok(!candidates.some((x) => x.skill === unrelated.key));
});
