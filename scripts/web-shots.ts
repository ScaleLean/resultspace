// Real-browser screenshots of the web app: in-process server with seeded data, headless Chromium over DevTools.
// Usage: node scripts/web-shots.ts   (needs `npm run build` first; writes /tmp/rs-web-shots/<page>-<w>.png)
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { addAgent, type Actor } from "../src/core/agents.ts";
import { run } from "../src/operations/index.ts";
import { startServer } from "../src/server.ts";

const OUT = "/tmp/rs-web-shots";
const EMAIL = "alex@example.test";
const PASSWORD = "a-long-test-passphrase-91";
const admin: Actor = { kind: "person", name: "alex", role: "admin" };
const rec = (...a: Parameters<typeof run>) => run(...a) as { id: string; key: string };

function seed(s: Awaited<ReturnType<typeof startServer>>) {
  const acme = s.companies.create("acme", "Acme Travel Goods");
  s.companies.create("other-co", "Other Co");
  const shared = s.companies.create("payload-shared", "Payload Shared");
  addAgent(acme, "hermes:acme");
  const goal = rec(acme, admin, "record.create", { kind: "goal", body: { title: "Double repeat orders by Q2", status: "active" } });
  const project = rec(acme, admin, "record.create", { kind: "project", body: { title: "Launch the travel pillow", status: "active", goal_id: goal.id } });
  const task = rec(acme, admin, "record.create", { kind: "task", body: { title: "Write the label copy for the memory-foam travel pillow", status: "todo", project_id: project.id } });
  const task2 = rec(acme, admin, "record.create", { kind: "task", body: { title: "Photograph the pillow in three colours", status: "todo", project_id: project.id } });
  rec(acme, admin, "record.patch", { ref: task.key, set: { status: "in_progress" }, why: "started the copy" });
  rec(acme, admin, "record.create", { kind: "entry", body: { type: "outcome", title: "Label copy approved by legal", project_id: project.id, about_id: task.id } });
  rec(acme, admin, "record.create", { kind: "entry", body: { type: "action", action: "email", title: "Sent the label proof to the printer", detail: "One PDF, two pages, CMYK.", project_id: project.id } });
  rec(acme, admin, "record.create", { kind: "entry", body: { type: "action", action: "spend", title: "Bought 200 sample labels", detail: "Rush order from the printer.", amount: 48, unit: "$", project_id: project.id } });
  rec(acme, admin, "record.create", { kind: "entry", body: { type: "session", title: "hermes:acme session: checked the claims list", detail: "Read the claims list and the label copy; two differences found." } });
  rec(acme, admin, "record.create", { kind: "entry", body: { type: "note", title: "Printer prefers CMYK files with 3 mm bleed" } });
  rec(acme, admin, "record.create", { kind: "assignment", body: { title: "Check the label claims against the claims list", owner: "hermes:acme", brief: "Compare every claim on the label with the approved claims list and report the differences.", project_id: project.id } });
  rec(acme, admin, "record.create", { kind: "flag", body: { title: "Task has no due date", status: "open", about_id: task.id } });
  rec(acme, admin, "request.propose", { title: "Mark the label task done", operation: "record.patch", input: { ref: task.key, set: { status: "done" } }, why: "legal approved the copy" });
  rec(acme, admin, "request.propose", { title: "Cancel the photo shoot", operation: "record.patch", input: { ref: task2.key, set: { status: "cancelled" } }, why: "the supplier sent product photos" });
  rec(acme, admin, "record.create", { kind: "briefing", body: { title: "Briefing for Alex", text: "Zebra-stripe pillows shipped on Monday. Two requests wait for you; one flag is open on the label task." } });
  for (const [collection, title, body] of [
    ["Products", "Travel pillow facts", "Memory foam, 320 g, machine washable cover."],
    ["Products", "Neck wrap facts", "Microfibre, 180 g, fits in the pillow pouch."],
    ["Policies", "Returns policy", "30 days, unused, original packaging."],
    ["Policies", "Claims we may make", "No medical claims. 'Supportive' is fine; 'therapeutic' is not."],
  ]) rec(acme, admin, "record.create", { kind: "knowledge", body: { title, body, collection } });
  const claims = (run(acme, admin, "record.list", { kind: "knowledge", limit: 10 }) as { id: string; body: { title: string } }[]).find((k) => k.body.title === "Claims we may make")!;
  const skill = rec(acme, admin, "record.create", { kind: "skill", body: { title: "Check label claims", when: "a label, ad or product page makes a claim about the product", status: "active", knowledge_ids: [claims.id],
    body: "# Steps\n\n1. Open the claims list (KNW-0004).\n2. Compare **every** claim on the label with it.\n3. Report the differences, result first.\n\n## Words to avoid\n\n- `therapeutic`, `medical`, `cures`\n- Anything about pain relief" } });
  rec(acme, admin, "record.create", { kind: "skill", body: { title: "Photograph a product", when: "a new product or colour arrives", status: "draft", body: "Three colours, white background, 2000 px on the long side." } });
  rec(shared, admin, "record.create", { kind: "skill", body: { title: "Old way to report", status: "retired", body: "Superseded." } });
  rec(shared, admin, "record.create", { kind: "skill", body: { title: "Write a work report", when: "an assignment is done", status: "active", body: "Say what changed first. Then what you did. Then what is left." } });
  return { task, skill };
}

type Msg = { id?: number; method?: string; params?: any; result?: any; sessionId?: string };
function cdp(ws: WebSocket) {
  let n = 0;
  const waits = new Map<number, (m: Msg) => void>();
  const events: ((m: Msg) => void)[] = [];
  ws.onmessage = (e) => { const m: Msg = JSON.parse(String(e.data)); if (m.id && waits.has(m.id)) { waits.get(m.id)!(m); waits.delete(m.id); } else events.forEach((f) => f(m)); };
  const send = (method: string, params: any = {}, sessionId?: string) =>
    new Promise<any>((ok, no) => { const id = ++n; waits.set(id, (m: any) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const once = (method: string, sessionId?: string) => new Promise<Msg>((ok) => { const f = (m: Msg) => { if (m.method === method && m.sessionId === sessionId) { events.splice(events.indexOf(f), 1); ok(m); } }; events.push(f); });
  return { send, once };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "rs-shots-"));
  // Sign-in mode (the shots are the hosted look); the default would trust 127.0.0.1 and skip the sign-in cookie.
  const s = await startServer({ dataDir: dir, port: 0, host: "127.0.0.1", trust: "none", faux: fauxProvider(), sharedCompany: "payload-shared" });
  const base = `http://127.0.0.1:${s.port}`;
  await s.people.add("alex", EMAIL, { password: PASSWORD });
  const { task, skill } = seed(s);
  const r = await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString() });
  const [name, value] = r.headers.getSetCookie()[0]!.split(";")[0]!.split("=") as [string, string];

  const profile = mkdtempSync(join(tmpdir(), "rs-chrome-"));
  const chrome = spawn("/usr/bin/chromium", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise<string>((ok, no) => {
    let err = ""; chrome.stderr.on("data", (d) => { err += d; const m = /DevTools listening on (ws:\S+)/.exec(err); if (m) ok(m[1]!); });
    chrome.on("exit", (c) => no(new Error(`chromium exited ${c}: ${err}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((ok) => (ws.onopen = ok));
  const { send, once } = cdp(ws);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m: string, p?: any) => send(m, p, sessionId);
  await S("Page.enable"); await S("Network.enable"); await S("Runtime.enable");
  await S("Network.setCookie", { name, value, domain: "127.0.0.1", path: "/" });

  // A second server in trusted mode with no company yet: first-run set-up as `resultspace` shows it on a laptop.
  const dir2 = mkdtempSync(join(tmpdir(), "rs-shots-trusted-"));
  const s2 = await startServer({ dataDir: dir2, port: 0, host: "127.0.0.1", trust: "loopback", faux: fauxProvider() });
  const base2 = `http://127.0.0.1:${s2.port}`;

  const pages: [string, string][] = [["today", "/c/acme"], ["work", "/c/acme/work"], ["journal", "/c/acme/journal"], ["journal-actions", "/c/acme/journal?type=action"], ["knowledge", "/c/acme/knowledge"], ["skills", "/c/acme/skills"], ["skill", `/c/acme/skills/${skill.key}`], ["curator", "/c/acme/curator"], ["record", `/c/acme/r/${task.key}`], ["admin", "/c/acme/admin"], ["more", "/c/acme/more"], ["account", "/account"], ["setup", base2 + "/setup"]];
  const warnings: string[] = [];
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await S("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    for (const [page, path] of pages) {
      const loaded = once("Page.loadEventFired", sessionId);
      await S("Page.navigate", { url: path.startsWith("http") ? path : base + path });
      await loaded;
      await new Promise((ok) => setTimeout(ok, 150));
      // A full-page capture would paint the fixed bottom bar mid-page; pin it to the page's end for the picture only.
      if (mobile) await S("Runtime.evaluate", { expression: `(() => { const b = document.querySelector('.tabbar'); if (!b) return;
        const want = document.documentElement.scrollHeight - b.offsetHeight;
        b.style.position = 'absolute'; b.style.bottom = 'auto'; b.style.top = '0px';
        const off = b.getBoundingClientRect().top + scrollY; b.style.top = (want - off) + 'px'; })()` });
      const { cssContentSize } = await S("Page.getLayoutMetrics");
      const { data } = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.ceil(cssContentSize.height), scale: 1 } });
      writeFileSync(join(OUT, `${page}-${w}.png`), Buffer.from(data, "base64"));
      if (mobile) {
        const ev = await S("Runtime.evaluate", { expression: "document.documentElement.scrollWidth > innerWidth ? `${document.documentElement.scrollWidth} > ${innerWidth}` : ''", returnByValue: true });
        if (ev.result.value) warnings.push(`WARNING ${page} at ${w}px scrolls horizontally: ${ev.result.value}`);
        // Tap targets (links, buttons, inputs) that are visible must be at least 44px tall or wide; nothing may sit under the bottom bar.
        const taps = await S("Runtime.evaluate", { returnByValue: true, expression: `(() => {
          const small = []; const bar = document.querySelector('.tabbar'); const barTop = bar ? bar.getBoundingClientRect().top + scrollY : Infinity;
          const under = [];
          for (const el of document.querySelectorAll('main a, main button, main input, main select, main textarea, main summary')) {
            const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const inText = (el.tagName === 'A' && el.closest('p, li, .row-sub, .doc')) || (el.tagName === 'INPUT' && /checkbox|radio/.test(el.type) && el.closest('label'));
            if (!inText && r.height < 44 && r.width < 44) small.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '"');
          }
          const main = document.querySelector('main');
          if (main && bar) {
            const content = main.getBoundingClientRect().bottom + scrollY - parseFloat(getComputedStyle(main).paddingBottom);
            const barTopAbs = document.documentElement.scrollHeight - bar.getBoundingClientRect().height;
            if (content > barTopAbs + 1) under.push('content ends ' + Math.round(content) + ' > bar top ' + Math.round(barTopAbs));
          }
          return { small, under };
        })()` });
        for (const x of taps.result.value.small) warnings.push(`WARNING ${page} at ${w}px small tap target: ${x}`);
        for (const x of taps.result.value.under) warnings.push(`WARNING ${page} at ${w}px content under the bottom bar: ${x}`);
      }
      console.log(`${page}-${w}.png  ${Math.ceil(cssContentSize.height)}px tall`);
    }
  }
  for (const x of warnings) console.log(x);
  if (!warnings.length) console.log("no horizontal scroll at 390px");
  ws.close(); chrome.kill(); await s.close(); await s2.close();
  rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true });
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
