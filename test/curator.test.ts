// The Curator end to end with a scripted stand-in model: no real model calls, the real agent library.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { addAgent } from "../src/core/agents.ts";
import type { Rec, Revision } from "../src/core/records.ts";
import { Curator } from "../src/curator/curator.ts";
import { getMeta, saveSettings } from "../src/curator/settings.ts";
import { run } from "../src/operations/index.ts";
import { admin, member, rec, setup } from "./helpers.ts";

type Step = { tool: string; args: Parameters<typeof fauxToolCall>[1] } | string;
/** A model that plays `steps` in order: one tool call per turn, then a final line. */
function scripted(steps: Step[]) {
  const faux = fauxProvider();
  const prompts: string[] = [];
  const results: string[] = [];
  const next = (context: { messages: { role: string; content: unknown; sections?: Record<string, string> }[] }) => {
    const toolResults = context.messages.filter((m) => m.role === "toolResult");
    for (const m of context.messages) if (m.role === "system") prompts.push(Object.values(m.sections ?? {}).join("\n"));
    results.length = 0;
    results.push(...toolResults.map((m) => JSON.stringify(m.content)));
    const step = steps[Math.min(toolResults.length, steps.length - 1)]!;
    return typeof step === "string"
      ? fauxAssistantMessage(step)
      : fauxAssistantMessage(fauxToolCall(step.tool, step.args), { stopReason: "toolUse" });
  };
  faux.setResponses(Array.from({ length: 200 }, () => next as unknown as Parameters<typeof faux.setResponses>[0][number]));
  return { faux, prompts, results };
}

test("curator briefing, chat, spending limit, and the scheduler", async (t) => {
  const { dir, companies, acme, other } = setup(t);
  rec(acme, member, "journal.log", { title: "Site is live" });
  const model = scripted([
    { tool: "journal_list", args: { since: "24h" } },
    { tool: "curator_briefing", args: { title: "Briefing today", text: "Moved: Site is live (JNL-0001)." } },
    "BRF-0001",
  ]);
  const curator = new Curator(companies, { dataDir: dir, faux: model.faux, briefingHour: 0, person: "Alex" });
  t.after(() => curator.close());
  saveSettings(other, { auto: false });
  const reports = await curator.tick();
  assert.deepEqual(
    reports.map((r) => [r.duty, r.status]),
    [["briefing", "done"]],
  );
  assert.equal(rec(acme, admin, "record.get", { ref: "BRF-0001" }).body.text, "Moved: Site is live (JNL-0001).");
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

test("initial model accuracy review is bounded, checkpointed across restart, and respects the spending gate", async (t) => {
  const { dir, companies, acme } = setup(t);
  const claims = Array.from({ length: 23 }, (_, i) =>
    rec(acme, { ...member, name: "import" }, "record.create", {
      kind: i % 2 ? "fact" : "knowledge",
      body: i % 2
        ? { title: `Existing fact ${i}`, subject: "Supplier", predicate: `quote_${i}`, value_type: "number", value: i, source: "Supplier email" }
        : { title: `Existing knowledge ${i}`, body: "Check accuracy against the citation", source: "Supplier email" },
    }),
  );
  // Existing installations may already have skipped these claims with the old first-run cursor.
  acme.run("insert into meta values ('curator.review_seq', ?)", String(acme.one<{ n: number }>("select max(seq) as n from revisions")!.n));
  const faux = fauxProvider();
  const prompts: string[] = [];
  faux.setResponses(
    Array.from(
      { length: 10 },
      () =>
        ((context: { messages: { role: string; content: unknown }[] }) => {
          prompts.push(JSON.stringify(context.messages.filter((m) => m.role === "user")));
          return fauxAssistantMessage("Reviewed source accuracy; no supported correction.");
        }) as Parameters<typeof faux.setResponses>[0][number],
    ),
  );
  let curator = new Curator(companies, { dataDir: dir, faux });
  let c = await curator.for("acme");
  saveSettings(acme, { daily_cap_usd: 0.000001 });
  acme.run("insert into meta values (?, ?)", `curator.spend_base.${new Date().toISOString().slice(0, 10)}`, "-1");
  assert.equal((await c.review())!.status, "skipped");
  assert.equal(getMeta(acme, "curator.baseline_seq"), "0");
  assert.equal(prompts.length, 0, "no model call beyond the spending gate");
  saveSettings(acme, { daily_cap_usd: 0 });
  assert.equal((await c.review())!.duty, "initial-review");
  assert.equal(prompts[0]!.match(/rev 1 by import/g)!.length, 20);
  assert.ok(prompts[0]!.includes(claims[0]!.key));
  assert.ok(!prompts[0]!.includes(claims[20]!.key));
  const checkpoint = getMeta(acme, "curator.baseline_seq");
  const later = rec(acme, member, "record.create", { kind: "knowledge", body: { title: "Later claim", source: "Later email" } });
  await curator.close();
  curator = new Curator(companies, { dataDir: dir, faux });
  t.after(() => curator.close());
  c = await curator.for("acme");
  assert.equal(getMeta(acme, "curator.baseline_seq"), checkpoint);
  assert.equal((await c.review())!.duty, "initial-review");
  assert.equal(prompts[1]!.match(/rev 1 by import/g)!.length, 3);
  assert.ok(prompts[1]!.includes(claims[20]!.key));
  assert.ok(!prompts[1]!.includes(later.key));
  assert.equal((await c.review())!.duty, "review", "new writes after the high-water mark use normal incremental review");
  assert.ok(prompts[2]!.includes(later.key));
  assert.equal(getMeta(acme, "curator.baseline_seq"), getMeta(acme, "curator.baseline_end"));
  assert.equal(await c.review(), null);
  assert.equal(prompts.length, 3, "completed baseline does not repeatedly spend on old claims");
});
