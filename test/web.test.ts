// The web app, end to end: the real server in this process, the built SvelteKit handler, pages over HTTP.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { addAgent, issueKey } from "../src/core/agents.ts";
import { startServer } from "../src/server.ts";
import { admin, rec } from "./helpers.ts";

const BUILD = join(import.meta.dirname, "..", "build", "handler.js");
const SKIP = existsSync(BUILD) ? false : "the web app is not built (build/handler.js is missing): run `npm run build` first";
const EMAIL = "alex@example.test";
const PASSWORD = "a-long-test-passphrase-91";

// Sign-in mode unless told otherwise: the tests connect from 127.0.0.1, which the default (loopback) would trust.
async function serve(t: TestContext, trust: "none" | "loopback" = "none") {
  const dir = mkdtempSync(join(tmpdir(), "rs-web-"));
  const s = await startServer({ dataDir: dir, port: 0, host: "127.0.0.1", trust, faux: fauxProvider(), sharedCompany: "payload-shared" });
  t.after(async () => { await s.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${s.port}`;
  let cookie = "";
  const get = (path: string, withCookie = true) => fetch(base + path, { redirect: "manual", headers: { accept: "text/html", ...(withCookie && cookie ? { cookie } : {}) } });
  const post = (path: string, form: Record<string, string>, origin = base) =>
    fetch(base + path, { method: "POST", redirect: "manual", headers: { origin, accept: "text/html", "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(form).toString() });
  const signIn = async () => {
    const r = await post("/login", { email: EMAIL, password: PASSWORD });
    assert.equal(r.status, 303, `sign-in redirects (got ${r.status}: ${(await r.text()).slice(0, 300)})`);
    assert.equal(r.headers.get("location"), "/");
    const set = r.headers.getSetCookie();
    assert.equal(set.length, 1, "sign-in sets one session cookie");
    assert.match(set[0]!, /HttpOnly/);
    cookie = set[0]!.split(";")[0]!;
  };
  return { ...s, dataDir: dir, base, get, post, signIn, setCookie: (c: string) => { cookie = c; } };
}

/** Three companies; Acme has one of everything the Today page shows, and the shared company holds a skill every company may read. */
function seed(s: Awaited<ReturnType<typeof serve>>) {
  const acme = s.companies.create("acme", "Acme");
  const other = s.companies.create("other-co", "Other Co");
  const shared = s.companies.create("payload-shared", "Payload Shared");
  addAgent(acme, "hermes:acme");
  const goal = rec(acme, admin, "record.create", { kind: "goal", body: { title: "Double repeat orders", status: "active" } });
  const project = rec(acme, admin, "record.create", { kind: "project", body: { title: "Launch the travel pillow", status: "active", goal_id: goal.id } });
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Write the label copy", status: "todo", project_id: project.id } });
  rec(acme, admin, "record.patch", { ref: task.key, set: { status: "in_progress" }, why: "started the copy" });
  const result = rec(acme, admin, "record.create", { kind: "entry", body: { type: "outcome", title: "Label copy approved by legal", project_id: project.id, about_id: task.id } });
  const action = rec(acme, admin, "record.create", { kind: "entry", body: { type: "action", action: "email", title: "Sent the label proof to the printer", detail: "One PDF, two pages", project_id: project.id } });
  const note = rec(acme, admin, "record.create", { kind: "entry", body: { type: "note", title: "Printer prefers CMYK files" } });
  const assignment = rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Check the label claims", owner: "hermes:acme", brief: "Compare with the claims list", project_id: project.id } });
  const flag = rec(acme, admin, "record.create", { kind: "flag", body: { title: "Task has no due date", status: "open", about_id: task.id } });
  const request = rec(acme, admin, "request.propose", { title: "Mark the label task done", operation: "record.patch", input: { ref: task.key, set: { status: "done" } }, why: "legal approved the copy" });
  const briefing = rec(acme, admin, "record.create", { kind: "briefing", body: { title: "Briefing for Alex", text: "Zebra-stripe pillows shipped; one request waits for you." } });
  const knowledge = rec(acme, admin, "record.create", { kind: "knowledge", body: { title: "Claims we may make", body: "No medical claims.", collection: "Policies" } });
  const skill = rec(acme, admin, "record.create", { kind: "skill", body: { title: "Check label claims", when: "a label or ad mentions health", body: "# Steps\n\n1. Open the claims list.\n2. Compare **every** claim.\n\n- Flag `therapeutic`.", status: "active", knowledge_ids: [knowledge.id] } });
  // Keys count per company, so the shared company's first skill is also SKL-0001 and would be hidden behind Acme's; the one we look at is its second.
  rec(shared, admin, "record.create", { kind: "skill", body: { title: "Old shared way", status: "retired" } });
  const sharedSkill = rec(shared, admin, "record.create", { kind: "skill", body: { title: "Write a work report", when: "an assignment is done", body: "Say what changed first.", status: "active" } });
  const secret = rec(other, admin, "record.create", { kind: "task", body: { title: "Other company only", status: "todo" } });
  return { acme, other, shared, goal, project, task, result, action, note, assignment, flag, request, briefing, knowledge, skill, sharedSkill, secret };
}

test("web: nobody signed in is sent to sign in; a wrong password does not sign in", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  const first = await s.get("/");
  assert.equal(first.status, 303);
  assert.equal(first.headers.get("location"), "/setup", "a server with no account shows set-up");
  assert.equal((await s.get("/setup")).status, 200);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  s.companies.create("acme", "Acme");
  for (const path of ["/", "/c/acme", "/c/acme/r/TSK-0001", "/account", "/c/acme/admin"]) {
    const r = await s.get(path);
    assert.equal(r.status, 303, path);
    assert.equal(r.headers.get("location"), "/login", path);
  }
  const login = await s.get("/login");
  assert.equal(login.status, 200);
  assert.match(await login.text(), /name="password"/);
  assert.equal((await s.get("/reset")).status, 200);
  const bad = await s.post("/login", { email: EMAIL, password: "not the password" });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.getSetCookie().length, 0);
  assert.match(await bad.text(), /do not match/);
  await s.signIn();
  assert.equal((await s.get("/login")).status, 303, "signed in: the sign-in page sends you on");
  const picker = await s.get("/");
  const html = picker.status === 200 ? await picker.text() : "";
  // One company: the picker may show it or go straight to it.
  assert.ok(html.includes("Acme") || picker.headers.get("location") === "/c/acme", `picker: ${picker.status}`);
});

test("web: Today shows the briefing, the request and the flag; approving runs the change", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  const d = seed(s);
  await s.signIn();
  const picker = await (await s.get("/")).text();
  assert.match(picker, /Acme/);
  assert.match(picker, /Other Co/);
  const today = await s.get("/c/acme");
  assert.equal(today.status, 200);
  const html = await today.text();
  assert.match(html, /Zebra-stripe pillows shipped/, "the briefing");
  assert.match(html, /Mark the label task done/, "the open request");
  assert.match(html, /legal approved the copy/, "why the request was made");
  assert.match(html, /Task has no due date/, "the open flag");
  assert.match(html, /\?\/decide/, "the request has a decide form");
  assert.match(html, /\?\/flag/, "the flag has a form");

  const approved = await s.post("/c/acme?/decide", { key: d.request.key, approve: "yes" });
  assert.ok(approved.status === 200 || approved.status === 303, `approve: ${approved.status} ${(await approved.text()).slice(0, 300)}`);
  assert.equal(rec(d.acme, admin, "record.get", { ref: d.request.key }).body.status, "approved");
  assert.equal(rec(d.acme, admin, "record.get", { ref: d.request.key }).body.decided_by, "alex", "decided as the signed-in person");
  assert.equal(rec(d.acme, admin, "record.get", { ref: d.task.key }).body.status, "done", "the proposed change ran");
  const dismissed = await s.post("/c/acme?/flag", { key: d.flag.key, status: "dismissed" });
  assert.ok(dismissed.status === 200 || dismissed.status === 303, `dismiss: ${dismissed.status}`);
  assert.equal(rec(d.acme, admin, "record.get", { ref: d.flag.key }).body.status, "dismissed");
  const after = await (await s.get("/c/acme")).text();
  assert.doesNotMatch(after, /\?\/decide/, "nothing waits any more");
  assert.doesNotMatch(after, /Task has no due date/);
});

test("web: a record page shows links and history; another company's key is not there", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  const d = seed(s);
  await s.signIn();
  const page = await s.get(`/c/acme/r/${d.task.key}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Write the label copy/);
  assert.match(html, /Launch the travel pillow/, "points at its project");
  assert.match(html, /Label copy approved by legal/, "the result that is about it points back");
  assert.match(html, /started the copy/, "history shows why it changed");
  assert.match(html, /\?\/undo/, "the latest change can be undone");
  assert.match(html, /\?\/archive/);

  const undone = await s.post(`/c/acme/r/${d.task.key}?/undo`, { rev: "2" });
  assert.ok(undone.status === 200 || undone.status === 303, `undo: ${undone.status} ${(await undone.text()).slice(0, 300)}`);
  assert.equal(rec(d.acme, admin, "record.get", { ref: d.task.key }).body.status, "todo");
  const archived = await s.post(`/c/acme/r/${d.task.key}?/archive`, {});
  assert.ok(archived.status === 200 || archived.status === 303, `archive: ${archived.status}`);
  assert.equal(rec(d.acme, admin, "record.get", { ref: d.task.key }).archived, true);

  // Both companies have a TSK-0001; each page shows only its own.
  assert.equal(d.secret.key, d.task.key);
  assert.doesNotMatch(html, /Other company only/);
  assert.equal((await s.get(`/c/other-co/r/${d.goal.key}`)).status, 404, "Acme's goal is not in the other company");
  assert.equal((await s.get("/c/acme/r/TSK-9999")).status, 404);
  assert.equal((await s.get("/c/no-such-company")).status, 404);
  assert.equal((await s.get(`/c/no-such-company/r/${d.task.key}`)).status, 404);
});

test("web: every page answers; cross-site posts are refused; agent keys still work", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  const d = seed(s);
  await s.signIn();
  const pages = ["", "/curator", "/journal", "/journal?type=action", "/work", "/skills", `/skills/${d.skill.key}`, `/skills/${d.sharedSkill.key}`, "/knowledge", "/search", "/search?q=label", "/activity", "/admin", `/assignments/${d.assignment.key}`, "/more", `/r/${d.result.key}`, `/r/${d.action.key}`, `/r/${d.skill.key}`, `/r/${d.assignment.key}`, `/r/${d.briefing.key}`, `/r/${d.request.key}`, `/r/${d.flag.key}`];
  for (const p of [...pages.map((x) => `/c/acme${x}`), "/c/other-co", "/c/other-co/journal", "/c/other-co/work", "/c/other-co/skills", "/c/other-co/curator", "/account"]) {
    const r = await s.get(p);
    const body = await r.text();
    assert.equal(r.status, 200, `${p}: ${r.status} ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(-300)}`);
  }
  assert.match(await (await s.get("/c/acme/search?q=label")).text(), /Write the label copy/);
  assert.match(d.result.key, /^JNL-\d{4}$/, "entries are JNL- keys");
  assert.match(d.skill.key, /^SKL-\d{4}$/, "skills are SKL- keys");

  // Work lists the goal, its project and the open task.
  const work = await (await s.get("/c/acme/work")).text();
  assert.match(work, /Double repeat orders/, "the goal");
  assert.match(work, /Launch the travel pillow/, "the project");
  assert.match(work, /Write the label copy/, "the open task");
  assert.match(work, /<h2>Assignments<\/h2>/, "assignments, not work orders");
  assert.doesNotMatch(work, /[Ww]ork orders?/);
  assert.match(work, /Check the label claims/, "the open assignment");
  assert.match(work, new RegExp(`href="/c/acme/assignments/${d.assignment.key}"`));
  const project = await (await s.get(`/c/acme/r/${d.project.key}`)).text();
  assert.match(project, /<h2>Assignments<\/h2>/);
  assert.match(project, /Check the label claims/, "the project lists its assignments");
  const one = await (await s.get(`/c/acme/assignments/${d.assignment.key}`)).text();
  for (const part of [/Check the label claims/, /Waiting for the agent/, /Compare with the claims list/, /No outcome reported yet/, /Cancel this assignment/]) assert.match(one, part);
  assert.match(await (await s.get("/c/acme")).text(), /Open assignments/);

  // The Journal shows every type; ?type=action shows only actions. The server view agrees.
  const journal = await (await s.get("/c/acme/journal")).text();
  assert.match(journal, /Label copy approved by legal/);
  assert.match(journal, /Sent the label proof to the printer/);
  assert.match(journal, /Printer prefers CMYK files/);
  const actionsOnly = await (await s.get("/c/acme/journal?type=action")).text();
  assert.match(actionsOnly, /Sent the label proof to the printer/);
  assert.doesNotMatch(actionsOnly, /Label copy approved by legal/);
  assert.doesNotMatch(actionsOnly, /Printer prefers CMYK files/);
  const listed = rec(d.acme, admin, "journal.list", { type: "action" }) as unknown as { key: string; type: string }[];
  assert.deepEqual(listed.map((e) => [e.key, e.type]), [[d.action.key, "action"]]);

  // Skills: our own and the shared company's, which is marked; the other company's page shows the shared one too but not ours.
  const skills = await (await s.get("/c/acme/skills")).text();
  assert.match(skills, /Check label claims/, "our skill");
  assert.match(skills, /Write a work report/, "the shared skill");
  assert.match(skills, /Shared skills/);
  const otherSkills = await (await s.get("/c/other-co/skills")).text();
  assert.match(otherSkills, /Write a work report/);
  assert.doesNotMatch(otherSkills, /Check label claims/, "Acme's skill stays in Acme");
  const sharedList = rec(d.acme, admin, "skill.list", {}) as unknown as { key: string; shared: boolean; company: string }[];
  assert.deepEqual(sharedList.map((x) => [x.company, x.shared]), [["acme", false], ["payload-shared", true], ["payload-shared", true]]);

  // One skill: its markdown rendered (escaped, with tags added) and its knowledge link.
  const page = await (await s.get(`/c/acme/skills/${d.skill.key}`)).text();
  assert.match(page, /Check label claims/);
  assert.doesNotMatch(page, /<h1>Check label claims<\/h1>/, "the file's title heading is not repeated under the page heading");
  assert.match(page, /Use when:.*a label or ad mentions health/);
  assert.match(page, /<ol><li>Open the claims list\.<\/li><li>Compare <strong>every<\/strong> claim\.<\/li><\/ol>/, "the markdown is rendered");
  assert.match(page, /<li>Flag <code>therapeutic<\/code>\.<\/li>/);
  assert.match(page, new RegExp(`href="/c/acme/r/${d.knowledge.key}"`), "links the knowledge it depends on");
  assert.match(page, /Claims we may make/);
  const sharedPage = await (await s.get(`/c/acme/skills/${d.sharedSkill.key}`)).text();
  assert.match(sharedPage, /Write a work report/);
  assert.match(sharedPage, /shared from payload-shared/);
  assert.equal((await s.get("/c/acme/skills/SKL-9999")).status, 404);

  // The old paths go to the new ones.
  for (const [from, to] of [["/c/acme/plans", "/c/acme/work"], ["/c/acme/results", "/c/acme/journal"], ["/c/acme/results?type=action", "/c/acme/journal?type=action"], [`/c/acme/goals/${d.goal.key}`, null], [`/c/acme/projects/${d.project.key}`, null],
    [`/c/acme/work/${d.assignment.key}`, `/c/acme/assignments/${d.assignment.key}`]] as const) {
    const r = await s.get(from);
    assert.ok(r.status >= 301 && r.status <= 308, `${from}: ${r.status}`);
    if (to) assert.equal(r.headers.get("location"), to, from);
  }
  const inbox = await s.get("/api/c/acme/inbox");
  assert.equal(inbox.status, 200);
  assert.equal((await s.get("/api/c/acme/chat")).status, 200);

  const evil = await s.post("/c/acme?/decide", { key: d.request.key, approve: "yes" }, "https://evil.example");
  assert.equal(evil.status, 403);
  assert.equal(rec(d.acme, admin, "record.get", { ref: d.request.key }).body.status, "open", "the cross-site post changed nothing");
  assert.equal((await s.post("/login", { email: EMAIL, password: PASSWORD }, "https://evil.example")).status, 403);

  const key = issueKey(d.acme, "hermes:acme");
  const me = await fetch(`${s.base}/v1/me`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(me.status, 200);
  assert.deepEqual(((await me.json()) as { company: unknown }).company, { slug: "acme", name: "Acme" });
  assert.equal((await fetch(`${s.base}/v1/me`)).status, 401);
  assert.equal((await fetch(`${s.base}/health`)).status, 200);
});

test("web: the other forms work, refuse bad input without breaking, and sign-out ends the session", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  const d = seed(s);
  await s.signIn();
  /** Post a form; the page must render (200), go on (303) or refuse politely (4xx) - never break (5xx). */
  const send = async (path: string, form: Record<string, string>, want: number[] = [200, 303]) => {
    const r = await s.post(path, form);
    const body = await r.text();
    assert.ok(want.includes(r.status), `${path}: ${r.status} ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(-300)}`);
    return body;
  };
  const get = (ref: string) => rec(d.acme, admin, "record.get", { ref });

  // Work: add a goal and a project under it; a missing title is refused.
  await send("/c/acme/work?/goal_add", { title: "Open a second market", status: "active" });
  const goals = rec(d.acme, admin, "record.list", { kind: "goal" }) as unknown as { key: string; id: string; body: { title: string } }[];
  const made = goals.find((g) => g.body.title === "Open a second market");
  assert.ok(made, "the goal was added");
  await send("/c/acme/work?/project_add", { title: "Translate the store", status: "active", goal: made.id });
  assert.match(await (await s.get("/c/acme/work")).text(), /Translate the store/);
  await send("/c/acme/work?/goal_edit", { ref: made.key, title: "Open a second market in spring", status: "active" });
  assert.equal(get(made.key).body.title, "Open a second market in spring");
  assert.match(await send("/c/acme/work?/goal_add", { title: "", status: "active" }, [400, 422]), /Give it a title/);

  // Journal: log an outcome and a note; an empty title is refused.
  await send("/c/acme/journal?/log", { title: "Second market opened", type: "outcome", detail: "Soft launch", project: d.project.key });
  const logged = (rec(d.acme, admin, "journal.list", { type: "outcome" }) as unknown as { title: string; project: string | null }[]).find((e) => e.title === "Second market opened");
  assert.ok(logged, "the outcome was logged");
  assert.equal(logged.project, d.project.key);
  await send("/c/acme/journal?/log", { title: "", type: "note" }, [400, 422]);

  // Skills: add one that cites knowledge by key; a missing title is refused.
  await send("/c/acme/skills?/add", { title: "Photograph a product", when: "a new product arrives", body: "Three colours, white background.", status: "draft", knowledge: d.knowledge.key });
  const skills = rec(d.acme, admin, "skill.list", { status: "draft" }) as unknown as { key: string; title: string; knowledge: { key: string }[] }[];
  const photo = skills.find((x) => x.title === "Photograph a product");
  assert.ok(photo, "the skill was added");
  assert.deepEqual(photo.knowledge.map((k) => k.key), [d.knowledge.key]);
  assert.match(await send("/c/acme/skills?/add", { title: "", when: "", body: "", status: "draft", knowledge: "" }, [400, 422]), /Give the skill a title/);

  // The record page: edit the title; an empty title is refused; an old revision is refused, not a crash.
  await send(`/c/acme/r/${d.goal.key}?/patch`, { title: "Triple repeat orders", rev: "1", why: "raised the bar" });
  assert.equal(get(d.goal.key).body.title, "Triple repeat orders");
  await send(`/c/acme/r/${d.goal.key}?/patch`, { title: "", rev: "2" }, [400, 422]);
  await send(`/c/acme/r/${d.goal.key}?/patch`, { title: "Too late", rev: "1" }, [400, 409, 422]);
  assert.equal(get(d.goal.key).body.title, "Triple repeat orders");
  await send(`/c/acme/r/${d.goal.key}?/archive`, {});
  await send(`/c/acme/r/${d.goal.key}?/restore`, {});
  assert.equal(get(d.goal.key).archived, false);
  assert.equal((await s.get(`/c/acme/r/${d.goal.key}`)).status, 200);

  // Today: declining, and deciding twice.
  await send("/c/acme?/decide", { key: d.request.key, approve: "no" });
  assert.equal(get(d.request.key).body.status, "declined");
  assert.equal(get(d.task.key).body.status, "in_progress", "a declined change does not run");
  await send("/c/acme?/decide", { key: d.request.key, approve: "yes" }, [400, 409, 422]);
  await send("/c/acme?/flag", { key: d.flag.key, status: "fixed" });
  assert.equal(get(d.flag.key).body.status, "fixed");

  // Assignments: cancel one; verify another's reported result (a report alone is not verified).
  await send(`/c/acme/assignments/${d.assignment.key}?/cancel`, { why: "no longer needed" });
  assert.equal(get(d.assignment.key).body.status, "cancelled");
  assert.equal((await s.get(`/c/acme/assignments/${d.assignment.key}`)).status, 200);
  assert.equal((await s.get("/c/acme/assignments/ASG-9999")).status, 404);
  assert.equal((await s.get("/c/acme/work/WO-9999")).status, 308, "old addresses redirect, even for keys that do not exist");
  const agent = { kind: "agent", name: "hermes:acme", role: "member" } as const;
  const second = rec(d.acme, admin, "record.create", { kind: "assignment", body: { title: "Count the pillows", owner: "hermes:acme" } });
  rec(d.acme, agent, "assignment.report", { ref: second.key, result: "We have 412 pillows" });
  const reported = await (await s.get(`/c/acme/assignments/${second.key}`)).text();
  assert.match(reported, /Result reported/);
  assert.match(reported, /nobody has verified it yet/);
  await send(`/c/acme/assignments/${second.key}?/verify`, { verdict: "maybe" }, [400, 422]);
  await send(`/c/acme/assignments/${second.key}?/verify`, { verdict: "verified", note: "Counted the shelf" });
  assert.deepEqual([get(second.key).body.verification, get(second.key).body.verified_by], ["verified", "alex"]);
  const checked = await (await s.get(`/c/acme/assignments/${second.key}`)).text();
  assert.match(checked, /Reported by hermes:acme [A-Z][a-z]{2} \d+, \d\d:\d\d\. Verified by alex/);
  assert.doesNotMatch(checked, /action="\?\/verify"/, "a verified result is not offered for verifying again");

  // Admin: brief, Curator settings, agents and keys. A new key is shown once and works.
  await send("/c/acme/admin?/brief", { brief: "We sell travel pillows." });
  assert.match(await (await s.get("/c/acme/admin")).text(), /We sell travel pillows\./);
  await send("/c/acme/admin?/settings", { thinking: "nope", daily_cap_usd: "2", model: "m", model_strong: "m" }, [400, 422]);
  await send("/c/acme/admin?/addAgent", { name: "Scout", role: "viewer" });
  const shown = await send("/c/acme/admin?/newKey", { name: "scout" });
  const key = /rsk_[A-Za-z0-9_-]+/.exec(shown)?.[0];
  assert.ok(key, "the new key is on the page");
  assert.equal((await fetch(`${s.base}/v1/me`, { headers: { authorization: `Bearer ${key}` } })).status, 200);
  await send("/c/acme/admin?/revoke", { name: "scout" });
  assert.equal((await fetch(`${s.base}/v1/me`, { headers: { authorization: `Bearer ${key}` } })).status, 401);
  await send("/c/acme/admin?/addAgent", { name: "not a name!", role: "viewer" }, [400, 422]);

  // The Curator page: an empty message is refused; a new chat and stop do not break.
  await send("/c/acme/curator?/say", { text: "" }, [400, 422]);
  await send("/c/acme/curator?/new", {});
  await send("/c/acme/curator?/stop", {});

  // Account: a wrong current password is refused; sign-out clears the cookie and the session.
  await send("/account?/password", { current: "wrong", next: "another-long-passphrase-7", again: "another-long-passphrase-7" }, [400, 401, 403, 422]);
  const out = await s.post("/account?/signout", {});
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), "/login");
  assert.match(out.headers.getSetCookie()[0] ?? "", /Max-Age=0/);
  assert.equal((await s.get("/c/acme")).headers.get("location"), "/login", "the old cookie no longer signs in");
});

test("web: a form sent by the page's script (use:enhance) still gets its session cookie", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  s.companies.create("acme", "Acme");
  const r = await fetch(`${s.base}/login`, { method: "POST", redirect: "manual", headers: { origin: s.base, accept: "application/json", "x-sveltekit-action": "true", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString() });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { type: "redirect", status: 303, location: "/" });
  assert.equal(r.headers.getSetCookie().length, 1);
});

test("web: sign-in mode: after the first account, set-up goes on to make the first company", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  const made = await s.post("/setup?/account", { name: "alex", email: EMAIL, password: PASSWORD });
  assert.equal(made.status, 303, `set-up: ${made.status} ${(await made.text()).slice(0, 300)}`);
  assert.equal(made.headers.get("location"), "/");
  const set = made.headers.getSetCookie();
  assert.equal(set.length, 1, "set-up signs you in");
  s.setCookie(set[0]!.split(";")[0]!);
  assert.equal((await s.get("/")).headers.get("location"), "/setup", "no company yet: set-up again, for the company");
  const page = await (await s.get("/setup")).text();
  assert.match(page, /name="slug"/, "the company form");
  assert.doesNotMatch(page, /name="password"/, "not the account form");
  const co = await s.post("/setup?/company", { name: "Acme", slug: "acme", key: "" });
  assert.equal(co.status, 303, `company: ${co.status} ${(await co.text()).slice(0, 300)}`);
  assert.equal(co.headers.get("location"), "/c/acme");
  assert.equal((await s.get("/setup")).headers.get("location"), "/", "set-up is over");
  assert.equal((await s.get("/c/acme")).status, 200);
});

/** A stand-in for api.fireworks.ai: GET /models answers 200 for "good-key" and 401 for anything else. */
function fakeFireworks(t: TestContext) {
  const fw = createServer((req, res) => {
    const ok = req.url === "/models" && req.headers.authorization === "Bearer good-key";
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" }).end(ok ? '{"data":[]}' : '{"error":"unauthorized"}');
  });
  const was = process.env.FIREWORKS_BASE_URL;
  t.after(() => { fw.close(); if (was === undefined) delete process.env.FIREWORKS_BASE_URL; else process.env.FIREWORKS_BASE_URL = was; });
  return new Promise<void>((ok) => fw.listen(0, "127.0.0.1", () => { process.env.FIREWORKS_BASE_URL = `http://127.0.0.1:${(fw.address() as AddressInfo).port}`; ok(); }));
}

test("web: trusted mode: no sign-in from this machine; set-up makes the company; Admin takes the model key", { skip: SKIP }, async (t) => {
  await fakeFireworks(t);
  const s = await serve(t, "loopback");
  const first = await s.get("/");
  assert.equal(first.status, 303);
  assert.equal(first.headers.get("location"), "/setup", "no company yet: set-up, not sign-in");
  const setup = await s.get("/setup");
  assert.equal(setup.status, 200);
  const page = await setup.text();
  assert.match(page, /runs on this machine/, "the trusted welcome");
  assert.match(page, /name="slug"/);
  assert.match(page, /name="key"/, "the optional model key");
  assert.doesNotMatch(page, /name="password"/, "no account to make");
  for (const p of ["/login", "/reset"]) {
    const r = await s.get(p);
    assert.equal(r.status, 303, p);
    assert.equal(r.headers.get("location"), "/setup", `${p} goes to set-up while there is no company`);
  }

  // Testing a key from the set-up form, good and bad, without making the company.
  const good = await s.post("/setup?/testKey", { name: "Acme", slug: "acme", key: "good-key" });
  assert.equal(good.status, 200, `test key: ${good.status}`);
  assert.match(await good.text(), /The key works/);
  assert.match(await (await s.post("/setup?/testKey", { name: "Acme", slug: "acme", key: "bad-key" })).text(), /refused the key/);
  assert.equal(s.companies.slugs().length, 0, "testing a key makes no company");

  // A bad slug is refused with the form kept; then the company is made and we land in it.
  const badSlug = await s.post("/setup?/company", { name: "Acme", slug: "Not A Slug", key: "" });
  assert.equal(badSlug.status, 400);
  assert.match(await badSlug.text(), /slug/i);
  const co = await s.post("/setup?/company", { name: "Acme Travel", slug: "acme", key: "" });
  assert.equal(co.status, 303, `company: ${co.status} ${(await co.text()).slice(0, 300)}`);
  assert.equal(co.headers.get("location"), "/c/acme");
  assert.deepEqual(s.companies.slugs(), ["acme"]);
  assert.equal(s.companies.get("acme").name, "Acme Travel");

  // No sign-in anywhere: pages answer, /login and /reset send you home, nothing offers to sign out.
  for (const p of ["/c/acme", "/c/acme/admin", "/c/acme/more", "/c/acme/work", "/account"]) {
    const r = await s.get(p);
    const html = await r.text();
    assert.equal(r.status, 200, `${p}: ${r.status}`);
    assert.doesNotMatch(html, /Sign out/, `${p} offers no sign-out`);
    assert.doesNotMatch(html, /href="\/login"/, `${p} links no sign-in`);
  }
  assert.equal((await s.get("/")).headers.get("location"), "/c/acme", "one company: straight in");
  for (const p of ["/login", "/reset"]) {
    const r = await s.get(p);
    assert.equal(r.status, 303, p);
    assert.equal(r.headers.get("location"), "/", p);
  }
  assert.equal((await s.get("/setup")).headers.get("location"), "/", "set-up is over");
  const account = await (await s.get("/account")).text();
  assert.match(account, /From here, nobody signs in/);
  assert.doesNotMatch(account, /name="current"/, "no password form for the owner without a session");

  // Admin: the model key section and its test; a bad key is refused and nothing is saved.
  const admin = await (await s.get("/c/acme/admin")).text();
  assert.match(admin, /Model key/);
  assert.match(admin, /\?\/setKey/);
  assert.match(admin, /name="key"/);
  assert.match(await (await s.post("/c/acme/admin?/testKey", { key: "good-key" })).text(), /The key works/);
  const refused = await s.post("/c/acme/admin?/setKey", { key: "bad-key" });
  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /refused the key/);
  assert.ok(!existsSync(join(s.dataDir, "model.key")), "a refused key is not saved");
  assert.match(await (await s.post("/c/acme/admin?/setKey", { key: "" })).text(), /No key given/);

  // Admin: a second company from the browser.
  const second = await s.post("/c/acme/admin?/newCompany", { name: "Other Co", slug: "other-co" });
  assert.equal(second.status, 303, `new company: ${second.status} ${(await second.text()).slice(0, 300)}`);
  assert.equal(second.headers.get("location"), "/c/other-co");
  assert.deepEqual(s.companies.slugs().sort(), ["acme", "other-co"]);
  assert.match(await (await s.post("/c/acme/admin?/newCompany", { name: "Again", slug: "acme" })).text(), /already|exists/i);
  const picker = await (await s.get("/?pick")).text();
  assert.match(picker, /Acme Travel/);
  assert.match(picker, /Other Co/);
});
