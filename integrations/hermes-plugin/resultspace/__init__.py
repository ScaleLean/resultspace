"""ResultSpace for Hermes (general plugin).

ResultSpace is where people decide; agents carry it out. This plugin is how a Hermes profile
connects to that:

1. Company brief at session start: a cache-safe system-prompt section (built once per session,
   never mid-conversation) with current decisions, goals and cycle, open assignments and
   pending requests. Size-budgeted.
2. Outward-action log (pre_tool_call, audit only): nothing is gated. Outward
   actions (spend, ads, publish, email/message customers, prices, store settings, deploy) are
   RECORDED in ResultSpace (Autopilot, audit) and never blocked or paused. ResultSpace being
   unreachable blocks nothing either.
3. Receipts (post_tool_call + session end): a compact, secret-redacted trail in Autopilot,
   linked to the assignment being worked (never raw arguments).
4. Tools: rs_act (record an outward action; always allowed), rs_work (the agent's assignments: the tool
   keeps its old name so toolsets that list it keep working), and - when the
   ResultSpace memory provider is not active - rs_recall / rs_remember.
5. Live hand-off: while a session is live the plugin keeps a presence heartbeat, so the
   dispatcher leaves new assignments to it; they are delivered into the session with
   inject_message where Hermes allows it (classic CLI; the gateway needs an explicit
   allow_gateway_injection grant, which this plugin never sets).
6. (Removed: the "resultspace" approval transport. Hermes's own "may I run this?"
   prompts stay with Hermes; ResultSpace no longer answers them.)
7. Commands: `hermes resultspace status|brief|sync|doctor` and the `/rs` slash command.

Plugins never touch Hermes core: only the ctx API, hooks and ABCs are used.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any

from . import guard as _guard
from .rsclient import Client, RsError, TTLCache, profile_of

logger = logging.getLogger("resultspace.plugin")

SECTION_ID = "resultspace.brief"
BRIEF_BUDGET = 3500  # the section cap is 4000 chars
RECEIPT_TOOLS_SKIP = {"memory", "todo_list", "clarify", "session_search", "skills_list", "skill_view",
                      "show_tip", "read_file", "search_files", "rs_recall", "rs_work"}


class _State:
    """Per-process state, keyed by profile (one process can serve several profiles)."""

    def __init__(self):
        self.clients: dict[str, Client] = {}
        self.cache = TTLCache(30)
        self.lock = threading.Lock()
        self.assignment: dict[str, str] = {}  # session_id -> id of the assignment being worked
        self.receipts: dict[str, list] = {}  # session_id -> buffered receipt summaries
        self.heartbeat: dict[str, threading.Thread] = {}
        self.delivered: set[str] = set()
        self.settings: dict[str, Any] = {}


S = _State()


# ------------------------------------------------------------------------------------ identity
def _home() -> str | None:
    try:
        from hermes_constants import get_hermes_home

        return str(get_hermes_home())
    except Exception:
        return os.environ.get("HERMES_HOME")


def _profile() -> str:
    try:
        from hermes_cli.profiles import get_active_profile_name

        p = get_active_profile_name()
        if p and p != "custom":
            return p
    except Exception:
        pass
    return os.environ.get("RS_PROFILE") or profile_of(_home())


def client(profile: str | None = None) -> Client:
    p = profile or _profile()
    with S.lock:
        c = S.clients.get(p)
        if c is None:
            c = Client.for_profile(p, S.settings.get("server_url"))
            S.clients[p] = c
        return c


def _setting(ctx, key: str, default):
    try:
        v = ctx.get_config(key, default)
        return default if v is None else v
    except Exception:
        return default


# ------------------------------------------------------------------------------ 1. the brief
def build_brief(profile: str | None = None, budget: int = BRIEF_BUDGET) -> str:
    """The company brief for this profile's company (or companies). Raises on failure."""
    c = client(profile)
    b = c.get("/v1/brief", budget=budget)
    text = (b or {}).get("text") or ""
    who = c.me().get("actor", {}).get("name", "?")
    head = (f"You are {who} in ResultSpace, where people decide and agents carry it out. "
            "ResultSpace holds the business facts (decisions, goals, company, customer and "
            "product knowledge); your MEMORY.md and skills hold craft (how-to, tool quirks, lessons).\n\n")
    out = head + text
    if len(out) > budget:
        out = out[: budget - 40].rstrip() + "\n(… more: `rs brief`)"
    return out


def _section(info) -> str:
    try:
        return build_brief(info.get("profile_name") if info.get("profile_name") not in (None, "", "custom") else None,
                           int(S.settings.get("brief_chars", BRIEF_BUDGET)))
    except RsError as e:
        # Fail open for the brief: Hermes keeps working; say so once, briefly.
        return f"ResultSpace brief unavailable right now ({e.message}). Use `rs brief` when it's back."
    except Exception as e:  # never break session start
        logger.warning("resultspace brief failed: %s", e)
        return ""


# ------------------------------------------------------------------------------- 2. the guard
def _company_for_check(c: Client) -> str | None:
    return c.company_id()


def check_outward(action: str, detail: str, amount=None, unit=None, assignment=None,
                  ask_id=None, profile: str | None = None, guard: bool = False) -> dict:
    """Record an outward action in ResultSpace. Returns {"decision": "allow", "reason"}. Raises RsError."""
    c = client(profile)
    co = _company_for_check(c)
    if not co:
        raise RsError(0, "no default company for this profile (set default_company in the rs config)")
    body: dict[str, Any] = {"company_id": co, "action": action, "detail": detail[:300]}
    if amount is not None:
        body["amount"] = float(amount)
    if unit:
        body["unit"] = unit
    if assignment:
        body["assignment"] = assignment
    if guard:
        body["guard"] = True  # a raw tool call: a fresh `rs act` allow for this action clears it
    return c.post("/v1/permissions/check", body) or {}


def _pre_tool_call(tool_name: str = "", args=None, session_id: str = "", **_):
    """Audit only: record an outward-looking call in ResultSpace; never block."""
    if not S.settings.get("guard", True):
        return None
    try:
        o = _guard.classify(tool_name, args or {}, S.settings.get("_extra_patterns", ()))
    except Exception as e:  # a classifier bug must never affect a tool call
        logger.warning("resultspace outward classify failed: %s", e)
        return None
    if o is None:
        return None
    _buffer_receipt(session_id, f"{o.action}: {o.why}")
    try:
        check_outward(o.action, o.detail, assignment=S.assignment.get(session_id), guard=True)
    except Exception as e:  # unreachable: the call still goes ahead
        logger.info("resultspace outward record not sent: %s", e)
    return None


# ---------------------------------------------------------------------------- 3. receipts
def _buffer_receipt(session_id: str, summary: str):
    with S.lock:
        S.receipts.setdefault(session_id or "-", []).append(_guard.short(summary, 200))


def _post_tool_call(tool_name: str = "", args=None, status=None, duration_ms=0,
                    session_id: str = "", **_):
    if not S.settings.get("receipts", True) or tool_name in RECEIPT_TOOLS_SKIP:
        return None
    # Compact, redacted: the tool and a short gist, never raw args or results.
    gist = ""
    if isinstance(args, dict):
        for k in ("command", "query", "url", "path", "action", "name"):
            v = args.get(k)
            if isinstance(v, str) and v:
                gist = _guard.short(v, 80)
                break
    ok = "failed" if (status and str(status).lower() not in ("ok", "success", "completed")) else "ok"
    _buffer_receipt(session_id, f"{tool_name} {ok}{': ' + gist if gist else ''}")
    with S.lock:
        n = len(S.receipts.get(session_id or "-", []))
    if n >= 20:
        flush_receipts(session_id)
    return None


def flush_receipts(session_id: str, final: bool = False):
    with S.lock:
        items = S.receipts.pop(session_id or "-", [])
    if not items:
        return
    try:
        c = client()
        co = c.company_id()
        if not co:
            return
        steps = len(items)
        head = f"{steps} step{'s' if steps != 1 else ''}" + (" (session end)" if final else "")
        summary = f"{head}: " + "; ".join(items[-6:])
        c.post("/v1/agents/receipts", {"company_id": co, "assignment": S.assignment.get(session_id),
                                       "session": session_id, "summary": summary[:300],
                                       "detail": {"steps": steps}})
    except Exception as e:
        logger.info("resultspace receipts not sent: %s", e)


def _on_session_start(session_id: str = "", **_):
    # A dispatcher-started run is working one assignment: link receipts and outward-action records to it.
    # RS_WORK_ORDER is the old name of RS_ASSIGNMENT.
    ref = os.environ.get("RS_ASSIGNMENT") or os.environ.get("RS_WORK_ORDER")
    if ref:
        S.assignment[session_id] = ref
    try:
        _start_heartbeat(session_id)
    except Exception as e:
        logger.debug("resultspace presence not started: %s", e)
    return None


def _on_session_end(session_id: str = "", **_):
    flush_receipts(session_id, final=True)
    return None


# ------------------------------------------------------------------ 5. presence + live hand-off
def _thread(fn, name: str) -> threading.Thread:
    """Start a daemon thread under the caller's context (Hermes's helper when available)."""
    try:
        from agent.memory_provider import spawn_context_thread

        t = spawn_context_thread(fn, name=name)
    except Exception:
        t = threading.Thread(target=fn, name=name, daemon=True)
    t.start()
    return t


def _start_heartbeat(session_id: str):
    # A run the dispatcher started is not a live session: don't hold assignments back for it.
    if os.environ.get("RS_AGENT_RUN"):
        return
    prof = _profile()
    if prof in S.heartbeat and S.heartbeat[prof].is_alive():
        return
    ctx = S.settings.get("_ctx")

    def beat():
        while True:
            try:
                c = client(prof)
                c.post("/v1/agents/presence", {"session": session_id or "live"})
                _deliver_new_assignments(ctx, c, session_id)
            except Exception as e:
                logger.debug("resultspace heartbeat: %s", e)
            time.sleep(60)

    t = _thread(beat, "rs-presence")
    S.heartbeat[prof] = t


def _deliver_new_assignments(ctx, c: Client, session_id: str):
    """Queued assignments for this agent go into the live session where Hermes allows it."""
    if ctx is None:
        return
    me = (c.me().get("actor") or {}).get("name")
    for w in c.assignment_list(owner=me):
        if w.get("status") != "queued" or w.get("id") in S.delivered:
            continue
        msg = (f"[ResultSpace] New assignment {w.get('key')}: {w.get('title')}. "
               f"Claim it with `rs assignment claim {w.get('key')}`, do it, then "
               f"`rs assignment report {w.get('key')} --result \"<outcome>\"`. Your report is your word; a person verifies it.")
        try:
            ok = ctx.inject_message(msg, role="user")
        except Exception:
            ok = False
        if ok:
            S.delivered.add(w.get("id"))


# ----------------------------------------------------------------------------------- 4. tools
def _tool_act(args: dict, session_id: str = "", **_):
    a = args or {}
    action = str(a.get("action") or "")
    detail = str(a.get("detail") or "")
    if not action or not detail:
        return json.dumps({"error": "rs_act needs action and detail"})
    try:
        res = check_outward(action, detail, a.get("amount"), a.get("unit"),
                            a.get("assignment") or a.get("work_order") or S.assignment.get(session_id))
    except RsError as e:
        return json.dumps({"decision": "allow", "recorded": False,
                           "reason": f"not recorded: ResultSpace unreachable ({e.message}); go ahead"})
    return json.dumps(res)


def _tool_work(args: dict, session_id: str = "", **_):
    a = args or {}
    op = a.get("op") or "ls"
    c = client()
    try:
        if op == "ls":
            return json.dumps({"assignments": c.assignment_list()})
        if op in ("next", "claim"):
            if op == "claim":
                w = c.assignment_claim(a.get("id"))
                r = {"assignment": w, "claimed": True}
            else:
                r = c.assignment_next()
                w = r.get("assignment") or {}
            if w.get("id"):
                S.assignment[session_id] = w["id"]
            return json.dumps(r)
        if op == "show":
            return json.dumps(c.assignment_show(a.get("id")))
        return json.dumps({"error": f"unknown op {op}; use ls|next|claim|show (report with `rs assignment report`)"})
    except RsError as e:
        return json.dumps({"error": e.message, "status": e.status})


ACT_SCHEMA = {
    "name": "rs_act",
    "description": ("Record an outward action in ResultSpace (spend money, change ads, publish, email or "
                    "message customers, change prices or store settings, deploy) so people see it in "
                    "Autopilot. It never blocks: the answer is always allow."),
    "parameters": {"type": "object", "properties": {
        "action": {"type": "string", "enum": list(_guard.ACTIONS)},
        "detail": {"type": "string", "description": "What exactly, for what: 'raise the ad budget to $60/day for Calm Blend'"},
        "amount": {"type": "number", "description": "Size counted against a limit ($, pages, recipients)"},
        "unit": {"type": "string", "description": "Unit of amount (default $)"},
        "assignment": {"type": "string", "description": "The assignment this was done under (key or id), if any"},
    }, "required": ["action", "detail"]},
}
WORK_SCHEMA = {
    "name": "rs_work",
    "description": ("Your ResultSpace assignments (outcomes handed to you): op=ls (open), next (claim the oldest), "
                    "claim (id), show (id). Report results with `rs assignment report`; a person verifies them."),
    "parameters": {"type": "object", "properties": {
        "op": {"type": "string", "enum": ["ls", "next", "claim", "show"]},
        "id": {"type": "string", "description": "Assignment key (ASG-0001; older ones are WO-0001) or id"},
    }},
}


# --------------------------------------------------------------------------- 7. commands
def status_text() -> str:
    lines = []
    prof = _profile()
    try:
        c = client(prof)
        me = c.me(refresh=True)
        a = me.get("actor", {})
        lines.append(f"ResultSpace: connected to {c.server_url} as {a.get('name')} ({a.get('kind')}), profile {prof}")
        cos = ", ".join(f"{x.get('slug')} ({x.get('role')})" for x in me.get("companies", []))
        lines.append(f"Companies: {cos or 'none'}; default: {c.default_company or '-'}")
        lines.append(f"Open assignments: {len(c.assignment_list())}")
    except RsError as e:
        lines.append(f"ResultSpace: NOT connected (profile {prof}): {e.message}")
    lines.append(f"Outward-action log: {'on' if S.settings.get('guard', True) else 'off'} (never blocks); receipts: {'on' if S.settings.get('receipts', True) else 'off'}")
    return "\n".join(lines)


def doctor_text() -> str:
    out = [status_text()]
    try:
        from hermes_cli.config import load_config_readonly

        cfg = load_config_readonly() or {}
        mem = ((cfg.get("memory") or {}).get("provider")) or "(built-in only)"
        tr = (((cfg.get("security") or {}).get("approval") or {}).get("transport")) or "builtin"
        inj = (((cfg.get("plugins") or {}).get("entries") or {}).get("resultspace") or {}).get("allow_gateway_injection")
        out.append(f"Memory provider: {mem} (resultspace = business facts in ResultSpace; MEMORY.md keeps working)")
        out.append(f"Approval transport: {tr} (ResultSpace no longer provides one; Hermes answers its own prompts)")
        out.append(f"Gateway injection: {'granted' if inj is True else 'not granted (default)'}")
    except Exception as e:
        out.append(f"(config not readable: {e})")
    try:
        t0 = time.monotonic()
        o = _guard.classify("terminal", {"command": "git push origin main"})
        out.append(f"Guard self-test: `git push` -> {o.action if o else 'not outward'} ({(time.monotonic()-t0)*1000:.1f} ms)")
    except Exception as e:
        out.append(f"Guard self-test failed: {e}")
    return "\n".join(out)


def _cli_setup(p):
    sub = p.add_subparsers(dest="rs_cmd")
    sub.add_parser("status", help="Connection, identity, open assignments")
    b = sub.add_parser("brief", help="Print the company brief this profile gets at session start")
    b.add_argument("--chars", type=int, default=BRIEF_BUDGET)
    sub.add_parser("sync", help="Send buffered receipts now and refresh the identity")
    sub.add_parser("doctor", help="Check the connection, guard, memory provider and switches")


def _cli_run(args):
    cmd = getattr(args, "rs_cmd", None) or "status"
    if cmd == "brief":
        try:
            print(build_brief(budget=getattr(args, "chars", BRIEF_BUDGET)))
        except RsError as e:
            print(f"brief unavailable: {e.message}")
            return 1
    elif cmd == "sync":
        for sid in list(S.receipts):
            flush_receipts(sid)
        S.cache.clear()
        print(status_text())
    elif cmd == "doctor":
        print(doctor_text())
    else:
        print(status_text())
    return 0


def _slash(raw: str = ""):
    arg = (raw or "").strip().split()
    cmd = arg[0] if arg else "status"
    if cmd == "brief":
        try:
            return build_brief()
        except RsError as e:
            return f"brief unavailable: {e.message}"
    if cmd in ("assignments", "work"):
        try:
            rows = [f"{x.get('key')} [{x.get('status_words') or x.get('status')}] {x.get('title')}" for x in client().assignment_list()]
            return "\n".join(rows) or "No open assignments."
        except RsError as e:
            return f"ResultSpace: {e.message}"
    if cmd == "doctor":
        return doctor_text()
    return status_text()


# --------------------------------------------------------------------------------- register
def register(ctx):
    # Settings (plugins.entries.resultspace.settings.*); all optional.
    S.settings.update({
        "guard": bool(_setting(ctx, "guard", True)),
        "receipts": bool(_setting(ctx, "receipts", True)),
        "brief_chars": int(_setting(ctx, "brief_chars", BRIEF_BUDGET)),
        "server_url": _setting(ctx, "server_url", None),
        "_extra_patterns": _guard.patterns_from_config(_setting(ctx, "guard_patterns", [])),
        "_ctx": ctx,
    })
    S.cache = TTLCache(int(_setting(ctx, "cache_ttl_seconds", 30)))
    ctx.register_system_prompt_section(SECTION_ID, _section, max_chars=4000)
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_tool("rs_act", "resultspace", ACT_SCHEMA, _tool_act,
                      description="Record an outward action in ResultSpace (never blocks)", emoji="📝")
    ctx.register_tool("rs_work", "resultspace", WORK_SCHEMA, _tool_work,
                      description="Your ResultSpace assignments", emoji="📋")
    ctx.register_cli_command("resultspace", "ResultSpace link: status | brief | sync | doctor", _cli_setup, _cli_run,
                             description="ResultSpace for Hermes: company brief, assignments")
    ctx.register_command("rs", _slash, description="ResultSpace: status | brief | assignments | doctor",
                         args_hint="[status|brief|assignments|doctor]")
