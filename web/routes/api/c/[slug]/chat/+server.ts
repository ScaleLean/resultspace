// The Curator chat of one company, as JSON, for the chat page (web/routes/c/[slug]/curator).
//   GET                      -> ChatState { busy, messages, partial, tools }   (the page polls this)
//   POST { text, steer? }    -> say;   POST { stop: true } -> stop;   POST { new: true } -> start a new chat
//   POST answers { ok: true, chat } or { ok: false, error } (400).
// Same-origin only: SvelteKit's own CSRF check covers form posts, not JSON, so the origin header is checked here.
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const HEAD = { "cache-control": "no-store" };

function slugOf(locals: App.Locals, slug: string): string {
  if (!locals.rs.person) error(401, "Sign in first.");
  if (!locals.rs.companies().some((c) => c.slug === slug)) error(404, "No such company.");
  return slug;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const slug = slugOf(locals, params.slug);
  return json(await locals.rs.curator.chat(slug), { headers: HEAD });
};

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
  if (request.headers.get("origin") !== url.origin) error(403, "Cross-site requests are not allowed.");
  const slug = slugOf(locals, params.slug);
  const cur = locals.rs.curator;
  let body: { text?: unknown; steer?: unknown; stop?: unknown; new?: unknown };
  try { body = (await request.json()) ?? {}; } catch { error(400, "Send JSON."); }
  if (typeof body !== "object") error(400, "Send a JSON object.");

  if (body.stop === true) await cur.stop(slug);
  else if (body.new === true) await cur.newChat(slug);
  else {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json({ ok: false, error: "Write a message first." }, { status: 400, headers: HEAD });
    const r = await cur.say(slug, text, body.steer === true);
    if (!r.ok) return json({ ok: false, error: r.error }, { status: 400, headers: HEAD });
  }
  return json({ ok: true, chat: await cur.chat(slug) }, { headers: HEAD });
};
