// Every request: take the WebService that src/server.ts put on the Node request, gate on set-up and sign-in,
// and send any session cookie an action asked for.
//
// Trusted mode (rs.mode === "trusted": same machine, or the owner's tailnet): nobody signs in, so the sign-in
// pages just send you home. Sign-in mode: /login and /reset are open, everything else needs a person.
// First run (rs.needsSetup) goes to /setup in both modes; a signed-in person with no company yet may also
// open /setup to make the first company.
//
// Setting the session cookie from a form action (works together with redirect()):
//   const r = await locals.rs.signIn(email, password);
//   if (!r.ok) return fail(r.status, { error: r.error });
//   locals.setCookie.push(r.cookie);
//   redirect(303, "/");
import { error, redirect, type Handle } from "@sveltejs/kit";

const OPEN = ["/login", "/reset"];

export const handle: Handle = async ({ event, resolve }) => {
  const rs = event.platform?.req?.rs;
  if (!rs) error(503, "The web app must be started by the ResultSpace server.");
  event.locals.rs = rs;
  event.locals.setCookie = [];
  const path = event.url.pathname;
  if (rs.needsSetup) { if (path !== "/setup") redirect(303, "/setup"); }
  else if (path === "/setup") { if (!rs.person || rs.companies().length > 0) redirect(303, "/"); }
  else if (rs.mode === "trusted") { if (OPEN.includes(path)) redirect(303, "/"); }
  else if (!rs.person && !OPEN.includes(path)) redirect(303, "/login");
  const res = await resolve(event);
  const headers = new Headers(res.headers);
  // Every page: no framing, no sniffing, no referrer leaks, HTTPS pinned for a year, no device APIs.
  headers.set("x-frame-options", "DENY");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "same-origin");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cache-control", res.headers.get("cache-control") ?? "no-store");
  for (const c of event.locals.setCookie) headers.append("set-cookie", c);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
