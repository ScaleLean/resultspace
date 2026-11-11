"""ResultSpace memory provider for Hermes (activate with `memory.provider: resultspace-memory`).

ResultSpace owns business memory; Hermes MEMORY.md and skills own craft. This provider:
- prefetch: relevant Knowledge/decision records for the turn (ResultSpace Ask), short;
- sync_turn / session end: business facts stated in the conversation become `knowledge`
  records, source = session id + agent, marked agent-learned (a person confirms, edits or deletes);
- on_memory_write: built-in MEMORY.md/USER.md writes that look like business facts are
  mirrored the same way (the built-in memory keeps working and keeps its copy);
- tools: rs_recall (search ResultSpace), rs_remember (store a business fact).

Everything that talks to ResultSpace runs off the turn path (background threads, short
timeouts). If ResultSpace is unreachable the provider degrades to "no recall" and never
blocks a turn.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import sys
import threading
from pathlib import Path

from agent.memory_provider import MemoryProvider

from . import facts as _facts

logger = logging.getLogger("resultspace.memory")


def _load_rsclient():
    """Share the client with the general plugin (installed next to this one), or a bundled copy."""
    here = Path(__file__).resolve().parent
    for cand in (here.parent / "resultspace" / "rsclient.py", here / "rsclient.py"):
        if cand.exists():
            spec = importlib.util.spec_from_file_location("resultspace_rsclient", cand)
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                sys.modules.setdefault("resultspace_rsclient", mod)
                spec.loader.exec_module(mod)
                return mod
    raise ImportError("resultspace plugin (rsclient.py) not installed next to resultspace-memory")


RECALL_SCHEMA = {
    "name": "rs_recall",
    "description": ("Search ResultSpace (the source of truth for business facts: decisions, goals, "
                    "permissions, company, customer and product knowledge). Returns records with a snippet."),
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "description": "A few words: 'magnesium sleep proof'"},
        "limit": {"type": "integer", "default": 6},
    }, "required": ["query"]},
}
REMEMBER_SCHEMA = {
    "name": "rs_remember",
    "description": ("Store a BUSINESS fact in ResultSpace as agent-learned knowledge (a person confirms it). "
                    "For craft (how-to, tool quirks) use your own memory instead."),
    "parameters": {"type": "object", "properties": {
        "fact": {"type": "string", "description": "One clear sentence"},
        "title": {"type": "string"},
    }, "required": ["fact"]},
}


class ResultSpaceMemory(MemoryProvider):
    def __init__(self):
        self._rs = None
        self._client = None
        self._sid = ""
        self._profile = "default"
        self._primary = True
        self._recall: dict[str, str] = {}
        self._seen: set[str] = set()
        self._lock = threading.Lock()

    # -- required ---------------------------------------------------------------------------
    @property
    def name(self) -> str:
        return "resultspace-memory"

    def is_available(self) -> bool:
        # Config/deps only (no network): the general plugin's client must be importable.
        try:
            self._rs = self._rs or _load_rsclient()
            return True
        except Exception:
            return False

    def initialize(self, session_id: str, **kw) -> None:
        self._sid = session_id
        self._rs = self._rs or _load_rsclient()
        self._profile = kw.get("agent_identity") or self._rs.profile_of(kw.get("hermes_home"))
        self._primary = kw.get("agent_context", "primary") == "primary"
        try:
            self._client = self._rs.Client.for_profile(self._profile)
        except Exception as e:
            logger.info("resultspace memory: no client (%s); recall disabled", e)
            self._client = None

    def get_tool_schemas(self) -> list[dict]:
        return [RECALL_SCHEMA, REMEMBER_SCHEMA]

    # -- recall -----------------------------------------------------------------------------
    def system_prompt_block(self) -> str:
        return ("Business memory lives in ResultSpace: use rs_recall to look things up and rs_remember "
                "for new business facts. Keep craft (how-to, tool quirks) in your own memory.")

    def _ask(self, query: str, limit: int = 6) -> list[dict]:
        if not self._client or not query.strip():
            return []
        q = " ".join(query.split()[:12])
        r = self._client.request("GET", "/v1/ask", query={"q": q, "limit": limit}, timeout=3.0) or {}
        return list(r.get("hits") or [])

    @staticmethod
    def _fmt(hits: list[dict], n: int = 4) -> str:
        lines = []
        for h in hits[:n]:
            key = h.get("key") or h.get("kind")
            lines.append(f"- {key} {h.get('title')}: {(h.get('snippet') or '').strip()[:160]}")
        return "\n".join(lines)

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        with self._lock:
            ctx = self._recall.pop(session_id or self._sid, "")
        return f"ResultSpace records that may be relevant:\n{ctx}" if ctx else ""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        sid = session_id or self._sid

        def work():
            try:
                txt = self._fmt(self._ask(query))
                if txt:
                    with self._lock:
                        self._recall[sid] = txt
            except Exception as e:
                logger.debug("resultspace recall: %s", e)

        self._spawn(work, "rs-recall")

    # -- writing business facts -------------------------------------------------------------
    def _remember(self, fact: str, title: str | None = None, origin: str = "tool") -> dict:
        if not self._client:
            raise RuntimeError("ResultSpace not connected")
        fact = " ".join(fact.split())[:1000]
        key = fact.lower()
        with self._lock:
            if key in self._seen:
                return {"ok": True, "duplicate": True}
            self._seen.add(key)
        me = self._client.me()
        co = self._client.company_id()
        if not co:
            raise RuntimeError("no default company for this profile")
        import uuid

        body = {
            "title": title or _facts.title_for(fact),
            "body": fact,
            "status": "agent_learned",
            "collection": "agent-learned",
            "source": {"session": self._sid, "agent": me.get("actor", {}).get("name"), "via": f"hermes memory ({origin})"},
            "tags": ["agent-learned"],
        }
        op = {"op_id": str(uuid.uuid4()), "company_id": co, "entity_id": str(uuid.uuid4()),
              "kind": "knowledge", "base_rev": None, "action": {"type": "create", "body": body},
              "result": f"Learned: {body['title']}"[:160]}
        r = self._client.post("/v1/ops", {"ops": [op]}) or {}
        res = ((r.get("results") or [{}])[0].get("result")) or {}
        return {"ok": res.get("outcome") == "applied", "outcome": res}

    def sync_turn(self, user_content, assistant_content, *, session_id: str = "", messages=None,
                  turn_author=None) -> None:
        if not self._primary or not self._client:
            return
        found = _facts.facts_from_turn(str(user_content or ""), str(assistant_content or ""))
        if not found:
            return

        def work():
            for f in found:
                try:
                    self._remember(f, origin="conversation")
                except Exception as e:
                    logger.debug("resultspace remember: %s", e)

        self._spawn(work, "rs-sync")

    def on_memory_write(self, action, target, content, metadata=None) -> None:
        """Mirror built-in memory writes that are business facts (MEMORY.md keeps its copy)."""
        if action not in ("add", "replace") or not self._client or not content:
            return
        entries = [e for e in _facts.split_entries(str(content)) if _facts.is_business_fact(e)]
        if not entries:
            return

        def work():
            for e in entries[:3]:
                try:
                    self._remember(e, origin=f"{target} {action}")
                except Exception as ex:
                    logger.debug("resultspace mirror: %s", ex)

        self._spawn(work, "rs-mirror")

    def on_session_end(self, messages) -> None:
        return None  # facts are written per turn; receipts are the general plugin's job

    def handle_tool_call(self, tool_name, args, **kw) -> str:
        a = args or {}
        try:
            if tool_name == "rs_recall":
                hits = self._ask(str(a.get("query") or ""), int(a.get("limit") or 6))
                return json.dumps({"hits": [{k: h.get(k) for k in ("key", "kind", "title", "snippet", "entity_id")} for h in hits]})
            if tool_name == "rs_remember":
                fact = str(a.get("fact") or "")
                if not fact.strip():
                    return json.dumps({"error": "fact required"})
                return json.dumps(self._remember(fact, a.get("title"), origin="rs_remember"))
        except Exception as e:
            return json.dumps({"error": str(e)})
        return json.dumps({"error": f"unknown tool {tool_name}"})

    # -- helpers ----------------------------------------------------------------------------
    @staticmethod
    def _spawn(fn, name: str):
        try:
            from agent.memory_provider import spawn_context_thread

            t = spawn_context_thread(fn, name=name)
        except Exception:
            t = threading.Thread(target=fn, name=name, daemon=True)
        t.start()


def register(ctx):
    ctx.register_memory_provider(ResultSpaceMemory())
