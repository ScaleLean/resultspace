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
  const s = await startServer({ dataDir: dir, port: 0, host: "127.0.0.1", trust, faux: fauxProvider() });
  t.after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${s.port}`;
  let cookie = "";
  const get = (path: string, withCookie = true) =>
    fetch(base + path, { redirect: "manual", headers: { accept: "text/html", ...(withCookie && cookie ? { cookie } : {}) } });
  const post = (path: string, form: Record<string, string>, origin = base) =>
    fetch(base + path, {
      method: "POST",
      redirect: "manual",
      headers: { origin, accept: "text/html", "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
      body: new URLSearchParams(form).toString(),
    });
  const signIn = async () => {
    const r = await post("/login", { email: EMAIL, password: PASSWORD });
    assert.equal(r.status, 303, `sign-in redirects (got ${r.status}: ${(await r.text()).slice(0, 300)})`);
    assert.equal(r.headers.get("location"), "/");
    const set = r.headers.getSetCookie();
    assert.equal(set.length, 1, "sign-in sets one session cookie");
    assert.match(set[0]!, /HttpOnly/);
    cookie = set[0]!.split(";")[0]!;
  };
  return {
    ...s,
    dataDir: dir,
    base,
    get,
    post,
    signIn,
    setCookie: (c: string) => {
      cookie = c;
    },
  };
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

test("web: a form sent by the page's script (use:enhance) still gets its session cookie", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  s.companies.create("acme", "Acme");
  const r = await fetch(`${s.base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: s.base,
      accept: "application/json",
      "x-sveltekit-action": "true",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString(),
  });
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
  t.after(() => {
    fw.close();
    if (was === undefined) delete process.env.FIREWORKS_BASE_URL;
    else process.env.FIREWORKS_BASE_URL = was;
  });
  return new Promise<void>((ok) =>
    fw.listen(0, "127.0.0.1", () => {
      process.env.FIREWORKS_BASE_URL = `http://127.0.0.1:${(fw.address() as AddressInfo).port}`;
      ok();
    }),
  );
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
  for (const p of ["/c/acme", "/c/acme/admin", "/c/acme/more", "/c/acme/projects", "/account"]) {
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

test("web: authenticated author/read path for projects, facts, learning, issues, evidence and history", { skip: SKIP }, async (t) => {
  const s = await serve(t);
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  s.companies.create("acme", "Acme");
  s.companies.create("other-co", "Other Co");
  await s.signIn();
  const created = await s.post("/c/acme/projects?/create", {
    title: "Launch",
    goal: "Confirm suppliers",
    objectives: "Compare quotes\nDocument learning",
    current_state: "Researching",
    status: "active",
  });
  assert.equal(created.status, 303, await created.text());
  const path = created.headers.get("location")!;
  const html = await (await s.get(path)).text();
  assert.match(html, /Confirm suppliers/);
  assert.match(html, /Compare quotes/);
  assert.match(html, /Researching/);
  assert.doesNotMatch(html, /Claim assignment|Agent working|Approve request|Skills/);
  const sourceResponse = await s.post("/c/acme/sources?/create", { title: "Fact-only supplier source", detail: "Supplier email" });
  assert.equal(sourceResponse.status, 303);
  const fact = await s.post("/c/acme/facts?/create", {
    title: "Lead time",
    subject: "Supplier A",
    predicate: "lead_time",
    value_type: "number",
    value: "4",
    unit: "weeks",
    source: "Quote A dated Oct 11",
    source_ids: "SRC-0001",
    project_id: "PRJ-0001",
  });
  assert.equal(fact.status, 303, await fact.text());
  const factPath = fact.headers.get("location")!;
  const sourceHtml = await (await s.get(factPath)).text();
  assert.match(sourceHtml, /Quote A dated Oct 11/);
  assert.match(sourceHtml, /History and provenance/);
  assert.match(sourceHtml, /alex/);
  const wrong = await s.post("/c/acme/facts?/create", {
    title: "Bad value",
    subject: "Supplier",
    predicate: "price",
    value_type: "number",
    value: "four",
  });
  assert.equal(wrong.status, 400);
  assert.equal(
    (
      await s.post("/c/acme/knowledge?/create", {
        title: "Method learned",
        body: "Compare quote scopes before deciding",
        source: "Supplier quotes A and B",
        project_id: "PRJ-0001",
      })
    ).status,
    303,
  );
  assert.equal(
    (
      await s.post("/c/acme/issues?/create", {
        title: "Confirm packaging",
        detail: "Planning question",
        status: "open",
        project_id: "PRJ-0001",
      })
    ).status,
    303,
  );
  assert.equal(
    (
      await s.post("/c/acme/journal?/log", {
        title: "Quote compared",
        detail: "The current quote states four weeks",
        source: "Supplier quote A",
        type: "learning",
        project_id: "PRJ-0001",
      })
    ).status,
    303,
  );
  const unsourced = await s.post("/c/acme/journal?/log", {
    title: "Unsupported learning",
    type: "learning",
    project_id: "PRJ-0001",
    source: "  ",
  });
  assert.equal(unsourced.status, 400);
  assert.match(await unsourced.text(), /Learning needs a source/);
  const focused = await (await s.get(path)).text();
  assert.match(focused, /Method learned/);
  assert.match(focused, /Quote compared/);
  assert.match(focused, /Confirm packaging/);
  assert.match(focused, /Chronological log/);
  assert.match(focused, /sources<\/h2>/);
  assert.match(focused, /Fact-only supplier source/);
  const coForEdit = s.companies.get("acme");
  addAgent(coForEdit, "review-editor", "member");
  const editKey = issueKey(coForEdit, "review-editor");
  const editLog = await fetch(s.base + "/v1/op/record.patch", {
    method: "POST", headers: { authorization: `Bearer ${editKey}`, "content-type": "application/json" },
    body: JSON.stringify({ ref: "JNL-0001", set: { title: "Quote requires clarification", type: "note", detail: "Supplier withdrew confirmation" }, why: "New supplier email" }),
  });
  assert.equal(editLog.status, 200);
  const logReadback = await (await s.get("/c/acme/journal")).text();
  assert.match(logReadback, /Quote requires clarification/);
  assert.match(logReadback, /edited by/);
  assert.match(logReadback, /review-editor/);
  const editedContext = await (await s.get(path)).text();
  assert.match(editedContext, /Supplier withdrew confirmation/);
  assert.match(editedContext, /review-editor/);
  const valueEdit = await fetch(s.base + "/v1/op/record.patch", {
    method: "POST", headers: { authorization: `Bearer ${editKey}`, "content-type": "application/json" },
    body: JSON.stringify({ ref: "FCT-0001", set: { value: 8 }, why: "Revised quote" }),
  });
  assert.equal(valueEdit.status, 200);
  const metadataEdit = await s.post(factPath + "?/patch", { title: "Lead time retitled", value: "8", value_type: "number", source: "Quote A dated Oct 11, additional citation", rev: "2" });
  assert.equal(metadataEdit.status, 200, await metadataEdit.text());
  for (const readPath of [factPath, path]) {
    const claimHtml = await (await s.get(readPath)).text();
    assert.match(claimHtml, /Claim asserted: review-editor[^<]*revision 2/);
    assert.match(claimHtml, /Last edited: alex[^<]*revision 3/);
    assert.match(claimHtml, /Citations last changed: alex[^<]*revision 3/);
    assert.match(claimHtml, /Original record: alex/);
    assert.match(claimHtml, /&quot;value&quot;: 4|"value": 4/);
  }
  const preservedLog = await (await s.get("/c/acme/r/JNL-0001")).text();
  assert.match(preservedLog, /Quote compared/);
  assert.match(preservedLog, /Revision 1/);
  assert.match(preservedLog, /alex/);

  assert.equal((await s.get("/c/other-co/r/PRJ-0001")).status, 404);
  const patch = await s.post(path + "?/patch", {
    title: "Launch reviewed",
    goal: "Confirm suppliers",
    objectives: "Compare quotes",
    current_state: "Reviewed",
    status: "active",
    rev: "1",
    why: "Read both quotes",
  });
  assert.equal(patch.status, 200, await patch.text());
  assert.equal((await s.post(path + "?/patch", { title: "Stale overwrite", rev: "1" })).status, 400);
  assert.equal((await s.post(path + "?/patch", { title: "Cross-site", rev: "2" }, "https://evil.example")).status, 403);
  assert.match(await (await s.get(path)).text(), /Read both quotes/);
  const contradiction = await s.post("/c/acme/facts?/create", {
    title: "Different quote",
    subject: "Supplier A",
    predicate: "lead_time",
    value_type: "number",
    value: "6",
    unit: "weeks",
    source: "Quote B dated Oct 11",
    project_id: "PRJ-0001",
  });
  assert.equal(contradiction.status, 303);
  assert.equal((await s.post("/c/acme/curator?/review", {})).status, 200);
  const review = await (await s.get("/c/acme/curator")).text();
  assert.match(review, /contradiction/);
  assert.match(review, /revision 1/);
  const evidence = await (await s.get("/c/acme/r/FLG-0001")).text();
  assert.match(evidence, /Evidence at review/);
  assert.match(evidence, /Quote A dated Oct 11/);
  assert.match(evidence, /Quote B dated Oct 11/);
  for (const route of ["projects", "sources", "facts", "knowledge", "issues", "journal", "curator", "archive", "search", "activity", "admin"])
    assert.equal((await s.get("/c/acme/" + route)).status, 200, route);
  for (const route of ["work", "skills", "assignments/ASG-0001"]) assert.equal((await s.get("/c/acme/" + route)).status, 404, route);
  // Keep account, key lifecycle and sign-out protections exercised after the UI simplification.
  assert.equal((await s.post("/c/acme/admin?/addAgent", { name: "reader", role: "viewer" })).status, 200);
  const shown = await (await s.post("/c/acme/admin?/newKey", { name: "reader" })).text();
  const key = /rsk_[A-Za-z0-9_-]+/.exec(shown)![0];
  assert.equal((await fetch(s.base + "/v1/me", { headers: { authorization: "Bearer " + key } })).status, 200);
  await s.post("/c/acme/admin?/revoke", { name: "reader" });
  assert.equal((await fetch(s.base + "/v1/me", { headers: { authorization: "Bearer " + key } })).status, 401);
  assert.equal((await s.post("/account?/signout", {})).status, 303);
  assert.equal((await s.get(path)).headers.get("location"), "/login");
});
