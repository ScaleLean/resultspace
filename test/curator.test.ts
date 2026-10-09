// The Curator end to end with a scripted stand-in model: no real model calls, the real agent library.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { addAgent } from "../src/core/agents.ts";
import type { Rec, Revision } from "../src/core/records.ts";
import { Curator } from "../src/curator/curator.ts";
import { saveSettings } from "../src/curator/settings.ts";
import { run } from "../src/operations/index.ts";
import { admin, member, rec, setup } from "./helpers.ts";

type Step = { tool: string; args: Parameters<typeof fauxToolCall>[1] } | string;
/** A model that plays `steps` in order: one tool call per turn, then a final line. */
function scripted(steps: Step[]) {
  const faux = fauxProvider();
  const prompts: string[] = []; const results: string[] = [];
  const next = (context: { messages: { role: string; content: unknown; sections?: Record<string, string> }[] }) => {
    const toolResults = context.messages.filter((m) => m.role === "toolResult");
    for (const m of context.messages) if (m.role === "system") prompts.push(Object.values(m.sections ?? {}).join("\n"));
    results.length = 0; results.push(...toolResults.map((m) => JSON.stringify(m.content)));
    const step = steps[Math.min(toolResults.length, steps.length - 1)]!;
    return typeof step === "string" ? fauxAssistantMessage(step) : fauxAssistantMessage(fauxToolCall(step.tool, step.args), { stopReason: "toolUse" });
  };
  faux.setResponses(Array.from({ length: 200 }, () => next as unknown as Parameters<typeof faux.setResponses>[0][number]));
  return { faux, prompts, results };
}

test("curator review: links and flags on its own, is refused a change of meaning, proposes it instead", async (t) => {
  const { dir, companies, acme } = setup(t);
  addAgent(acme, "hermes:acme");
  rec(acme, member, "record.create", { kind: "project", body: { title: "Launch", status: "active" } });
  const model = scripted([
    { tool: "record_context", args: { ref: "JNL-0001" } },
    { tool: "record_patch", args: { ref: "JNL-0001", set: { project_id: "PRJ-0001" }, why: "belongs to Launch" } },
    { tool: "record_create", args: { kind: "flag", body: { title: "JNL-0002 reports effort, not an outcome", flag_type: "no_outcome", about_id: "JNL-0002", status: "open" } } },
    { tool: "record_patch", args: { ref: "TSK-0001", set: { status: "done" } } },
    { tool: "request_propose", args: { title: "Mark TSK-0001 done?", operation: "record.patch", input: { ref: "TSK-0001", set: { status: "done" } }, why: "JNL-0001 says it is finished" } },
    "Linked one result, flagged one, proposed one change.",
  ]);
  const curator = new Curator(companies, { dataDir: dir, faux: model.faux });
  t.after(() => curator.close());
  const c = await curator.for("acme");
  assert.equal(await c.review(), null, "the first review starts from now");

  rec(acme, member, "record.create", { kind: "task", body: { title: "Ship the label", status: "todo", project_id: "PRJ-0001" } });
  rec(acme, member, "journal.log", { title: "Label shipped to the printer" });
  rec(acme, member, "journal.log", { title: "Worked on the listing" });
  const report = (await c.review())!;
  assert.equal(report.status, "done");
  assert.match(report.detail, /Linked one result/);

  assert.equal(rec(acme, admin, "record.get", { ref: "JNL-0001" }).body.project_id, rec(acme, admin, "record.get", { ref: "PRJ-0001" }).id);
  const linked = (run(acme, admin, "record.history", { ref: "JNL-0001" }) as Revision[]).at(-1)!;
  assert.deepEqual([linked.actor, linked.actor_kind, linked.why], ["curator", "curator", "belongs to Launch"]);
  assert.match(linked.op_id ?? "", /^curator-tool:/, "a tool call is a repeat-safe op");
  assert.equal(rec(acme, admin, "record.get", { ref: "FLG-0001" }).body.flag_type, "no_outcome");
  assert.equal(rec(acme, admin, "record.get", { ref: "TSK-0001" }).body.status, "todo", "the Curator could not change a status itself");
  assert.ok(model.results.some((r) => r.includes("refused (forbidden)")), "the refusal went back to the model");
  assert.equal(rec(acme, admin, "record.get", { ref: "REQ-0001" }).body.status, "open");
  assert.match(model.prompts[0] ?? "", /You are NOT a work agent/);

  assert.equal(await c.review(), null, "its own writes are not reviewed again");
  assert.deepEqual(c.runs().map((r) => [r.duty, r.status]), [["review", "done"]]);
  // The owner approves the request: the change is made as the owner.
  run(acme, admin, "request.decide", { ref: "REQ-0001", approve: true });
  assert.equal(rec(acme, admin, "record.get", { ref: "TSK-0001" }).body.status, "done");
});

test("curator briefing, chat, spending limit, and the scheduler", async (t) => {
  const { dir, companies, acme, other } = setup(t);
  rec(acme, member, "journal.log", { title: "Site is live" });
  const model = scripted([
    { tool: "journal_list", args: { since: "24h" } },
    { tool: "record_create", args: { kind: "briefing", body: { title: "Briefing today", date: "today", text: "Moved: Site is live (JNL-0001)." } } },
    "BRF-0001",
  ]);
  const curator = new Curator(companies, { dataDir: dir, faux: model.faux, briefingHour: 0, person: "Alex" });
  t.after(() => curator.close());
  saveSettings(other, { auto: false });
  const reports = await curator.tick();
  assert.deepEqual(reports.map((r) => [r.duty, r.status]), [["briefing", "done"]]);
  const inbox = run(acme, admin, "inbox.get", {}) as { briefing: { key: string; text: string } | null };
  assert.equal(inbox.briefing?.text, "Moved: Site is live (JNL-0001).");
  assert.deepEqual(await curator.tick(), [], "one briefing a day; the other company has auto off");
  assert.equal((run(other, admin, "record.list", { kind: "briefing" }) as Rec[]).length, 0);

  const c = await curator.for("acme");
  assert.deepEqual(await c.say("What moved today?"), { ok: true });
  await c.waitForChat();
  const chat = await c.chat();
  assert.equal(chat.busy, false);
  assert.equal(chat.messages[0]?.who, "you");
  assert.ok(chat.messages.some((m) => m.who === "curator"));

  saveSettings(acme, { daily_cap_usd: 0.000001 });
  acme.run("update meta set v = '-1' where k like 'curator.spend_base.%'");
  const refused = await c.say("One more thing");
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.error, /spending limit/);
});
