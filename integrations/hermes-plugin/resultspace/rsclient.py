"""Talk to the ResultSpace server as this Hermes profile's agent identity.

Identity comes from the profile's own `rs` config:
  $RS_CONFIG, else ~/.config/resultspace/profiles/<profile>/cli.toml, else ~/.config/resultspace/cli.toml

    server_url = "http://127.0.0.1:4390"
    default_company = "acme"
    [companies.acme]
    key_file = "/path/acme.key"    # must be chmod 600

One key file per company: a key belongs to exactly one company, so no request names a company.
The config holds the PATH of each key file, never the key. The key is read from its file for
each request and never logged, printed or returned.

The server speaks `POST /v1/op/<operation>`. The named methods below (brief, record_action,
receipt, ...) call the operations directly. `get`/`post`/`request` still accept the routes the
plugins were written against (/v1/brief, /v1/work, /v1/ask, /v1/ops, ...) and translate them to
operations, returning the shapes the plugins read (`work_orders[]`, `hits[]`,
`results[].result.outcome`).

Assignments (an outcome handed to one agent) were called work orders before ResultSpace schema 3.
`assignment_*` call the new operations and fall back to the old `work.*` ones on a server that does
not have them yet; `work_*` and the /v1/work routes keep the old names and shapes.

Every failure is an RsError (status 0 when the server is unreachable or the config/key is
unusable). Stdlib only (urllib, tomllib): nothing to install into Hermes.
"""
from __future__ import annotations

import json
import os
import threading
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Mapping


class RsError(Exception):
    """A request to ResultSpace failed. `status` is the HTTP status, or 0 when unreachable."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def profile_of(hermes_home: str | os.PathLike | None) -> str:
    """The Hermes profile name for a home dir: .../profiles/<name> -> name; ~/.hermes -> default."""
    if not hermes_home:
        return "default"
    p = Path(hermes_home).expanduser()
    if p.parent.name == "profiles":
        return p.name
    return "default"


def config_path(profile: str, env: Mapping[str, str] | None = None) -> Path:
    e: Mapping[str, str] = os.environ if env is None else env
    if e.get("RS_CONFIG"):
        return Path(e["RS_CONFIG"]).expanduser()
    base = Path(e.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "resultspace"
    per = base / "profiles" / profile / "cli.toml"
    return per if per.exists() else base / "cli.toml"


_SCALAR = (str, int, float, bool)


def _pick(body: Any, *names: str) -> dict:
    """The named fields of a request body that are set (None and "" are left out)."""
    b = body if isinstance(body, dict) else {}
    return {k: b[k] for k in names if b.get(k) not in (None, "")}


class Client:
    """Minimal JSON client. Short timeouts: the guard runs inside Hermes's pre_tool_call."""

    def __init__(self, server_url: str, key_files: Mapping[str, str | os.PathLike] | None = None,
                 default_company: str | None = None, timeout: float = 4.0):
        self.server_url = server_url.rstrip("/")
        self.key_files: dict[str, Path] = {s: Path(p).expanduser() for s, p in (key_files or {}).items()}
        self.default_company = default_company
        self.timeout = timeout
        self._me: dict | None = None
        self._lock = threading.Lock()

    @classmethod
    def for_profile(cls, profile: str, server_override: str | None = None,
                    env: Mapping[str, str] | None = None) -> "Client":
        path = config_path(profile, env)
        try:
            cfg = tomllib.loads(path.read_text())
        except FileNotFoundError:
            raise RsError(0, f"no ResultSpace config for profile {profile!r} ({path} missing)")
        except Exception as e:  # malformed config
            raise RsError(0, f"unreadable ResultSpace config {path}: {e}")
        url = server_override or cfg.get("server_url")
        cos = cfg.get("companies") if isinstance(cfg.get("companies"), dict) else {}
        keys = {s: v["key_file"] for s, v in cos.items() if isinstance(v, dict) and v.get("key_file")}
        if not url:
            raise RsError(0, f"{path}: server_url is missing")
        if not keys:
            raise RsError(0, f"{path}: no [companies.<slug>] key_file entries")
        return cls(url, keys, cfg.get("default_company"))

    # ------------------------------------------------------------------ company and key

    def company_id(self, slug: str | None = None) -> str | None:
        """The company SLUG to act in: explicit, else the config default, else the only one."""
        want = slug or self.default_company
        if want:
            return want if want in self.key_files else None
        return next(iter(self.key_files)) if len(self.key_files) == 1 else None

    def _key(self, company: str | None = None) -> str:
        slug = self.company_id(company)
        if not slug:
            if company or self.default_company:
                raise RsError(0, f"no key_file configured for company {(company or self.default_company)!r}")
            raise RsError(0, "no default company for this profile (set default_company in the rs config)")
        p = self.key_files[slug]
        try:
            st = p.stat()
        except OSError as e:
            raise RsError(0, f"cannot read key file {p}: {e.strerror}")
        if st.st_mode & 0o077:
            raise RsError(0, f"key file {p} must not be readable by group/others (chmod 600)")
        try:
            t = p.read_text().strip()
        except OSError as e:
            raise RsError(0, f"cannot read key file {p}: {e.strerror}")
        if not t:
            raise RsError(0, f"key file {p} is empty")
        return t

    # ------------------------------------------------------------------ transport

    def _http(self, method: str, path: str, body: Any = None, company: str | None = None,
              timeout: float | None = None, idempotency_key: str | None = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.server_url + path, data=data, method=method)
        req.add_header("authorization", "Bearer " + self._key(company))
        if data is not None:
            req.add_header("content-type", "application/json")
        if idempotency_key:
            req.add_header("idempotency-key", idempotency_key)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read() or b"{}").get("error")
                msg = (err.get("message") if isinstance(err, dict) else err) or e.reason
            except Exception:
                msg = e.reason
            finally:
                e.close()
            raise RsError(e.code, str(msg))
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            raise RsError(0, f"ResultSpace unreachable at {self.server_url}: {getattr(e, 'reason', e)}")
        except ValueError as e:  # a reply that is not JSON
            raise RsError(0, f"unreadable reply from {self.server_url}: {e}")

    def op(self, name: str, input: dict | None = None, company: str | None = None,
           timeout: float | None = None, idempotency_key: str | None = None) -> Any:
        """Run one server operation and return its result."""
        r = self._http("POST", "/v1/op/" + name, input or {}, company, timeout, idempotency_key)
        return (r or {}).get("result")

    # ------------------------------------------------------------------ operations

    def me(self, refresh: bool = False) -> dict:
        """{actor:{kind,name,role}, company:{slug,name}, version} plus `companies` (the old shape)."""
        with self._lock:
            if self._me is None or refresh:
                m = dict(self._http("GET", "/v1/me") or {})
                co = m.get("company") or {}
                m["companies"] = [{"id": co.get("slug"), "slug": co.get("slug"), "name": co.get("name"),
                                   "role": (m.get("actor") or {}).get("role")}] if co.get("slug") else []
                self._me = m
            return self._me or {}

    def companies(self) -> list[dict]:
        return list(self.me().get("companies") or [])

    def brief(self, budget: int | None = None, company: str | None = None) -> dict:
        return self.op("brief.get", {"budget": int(budget)} if budget else {}, company) or {}

    @staticmethod
    def _under(assignment: str | None, work_order: str | None) -> dict:
        """The assignment an action or receipt was done under. Sent under both names: a server from
        before the rename reads `work_order`, a newer one accepts both when they agree."""
        ref = assignment or work_order
        return {"assignment": ref, "work_order": ref} if ref else {}

    def record_action(self, action: str, detail: str, amount: float | None = None, unit: str | None = None,
                      work_order: str | None = None, company: str | None = None, assignment: str | None = None) -> dict:
        body = _pick({"action": action, "detail": detail, "amount": amount, "unit": unit},
                     "action", "detail", "amount", "unit")
        return self.op("action.record", {**body, **self._under(assignment, work_order)}, company) or {}

    def receipt(self, summary: str, session: str | None = None, work_order: str | None = None,
                detail: dict | None = None, company: str | None = None, assignment: str | None = None) -> dict:
        body = {**_pick({"summary": summary, "session": session}, "summary", "session"), **self._under(assignment, work_order)}
        d = {k: v for k, v in (detail or {}).items() if isinstance(v, _SCALAR)}
        if d:
            body["detail"] = d
        return self.op("agent.receipt", body, company) or {}

    def presence(self, session: str, company: str | None = None) -> dict:
        return self.op("agent.presence", {"session": session}, company) or {}

    # ---- assignments (new names; fall back to work.* on a server from before the rename)
    def _op_or_old(self, name: str, old: str, input: dict, company: str | None) -> Any:
        try:
            return self.op(name, input, company)
        except RsError as e:
            if e.status == 404 and e.message == f"no operation {name}":
                return self.op(old, input, company)
            raise

    def assignment_list(self, all: bool | None = None, owner: str | None = None, project: str | None = None,
                        limit: int | None = None, company: str | None = None) -> list[dict]:
        inp = _pick({"all": all, "owner": owner, "project": project, "limit": limit}, "all", "owner", "project", "limit")
        if project:  # only the new operation filters by project
            return list(self.op("assignment.list", inp, company) or [])
        return list(self._op_or_old("assignment.list", "work.list", inp, company) or [])

    def assignment_next(self, company: str | None = None) -> dict:
        """{assignment: {...} | None, claimed: bool}."""
        r = dict(self._op_or_old("assignment.next", "work.next", {}, company) or {})
        if "work_order" in r:
            r["assignment"] = r.pop("work_order")
        return r

    def assignment_claim(self, ref: str, company: str | None = None) -> dict:
        return self.op("assignment.claim", {"ref": str(ref)}, company) or {}

    def assignment_show(self, ref: str, company: str | None = None) -> dict:
        """The assignment with `outcomes`, `sessions` and `actions` recorded under it."""
        r = dict(self._op_or_old("assignment.show", "work.show", {"ref": str(ref)}, company) or {})
        r.setdefault("outcomes", r.get("results", []))
        r.setdefault("sessions", r.get("receipts", []))
        return r

    # ---- the old names, with the old shapes (work_order, results, receipts)
    def work_list(self, all: bool | None = None, owner: str | None = None, limit: int | None = None,
                  company: str | None = None) -> list[dict]:
        return list(self.op("work.list", _pick({"all": all, "owner": owner, "limit": limit},
                                               "all", "owner", "limit"), company) or [])

    def work_next(self, company: str | None = None) -> dict:
        return self.op("work.next", {}, company) or {}

    def work_show(self, ref: str, company: str | None = None) -> dict:
        return self.op("work.show", {"ref": str(ref)}, company) or {}

    def search(self, q: str, kind: str | None = None, limit: int | None = None,
               company: str | None = None, timeout: float | None = None) -> list[dict]:
        return list(self.op("record.search", _pick({"q": q, "kind": kind, "limit": limit}, "q", "kind", "limit"),
                            company, timeout) or [])

    def create_record(self, kind: str, body: dict, result: str | None = None, why: str | None = None,
                      company: str | None = None, idempotency_key: str | None = None) -> dict:
        inp = {"kind": kind, "body": body, **_pick({"result": result, "why": why}, "result", "why")}
        return self.op("record.create", inp, company, idempotency_key=idempotency_key) or {}

    # ------------------------------------------------------------------ the routes the plugins use

    def request(self, method: str, path: str, body: Any = None, query: dict | None = None,
                timeout: float | None = None) -> Any:
        """Accepts the old /v1 routes and answers in their shapes. `company_id` in a body (now a
        slug) picks the key file and is not sent."""
        q = {k: v for k, v in (query or {}).items() if v is not None}
        b = body if isinstance(body, dict) else {}
        co = b.get("company_id") or q.get("company_id") or None
        m = method.upper()
        if (m, path) == ("GET", "/v1/me"):
            return self.me(refresh=True)
        if (m, path) == ("GET", "/v1/brief"):
            return self.brief(q.get("budget"), co)
        if (m, path) == ("POST", "/v1/permissions/check"):
            return self.record_action(b.get("action"), b.get("detail"), b.get("amount"), b.get("unit"),
                                      b.get("work_order"), co, b.get("assignment"))
        if (m, path) == ("POST", "/v1/agents/receipts"):
            return self.receipt(b.get("summary"), b.get("session"), b.get("work_order"), b.get("detail"), co,
                                b.get("assignment"))
        if (m, path) == ("POST", "/v1/agents/presence"):
            return self.presence(b.get("session") or "live", co)
        if (m, path) == ("GET", "/v1/work"):
            return {"work_orders": self.work_list(q.get("all"), q.get("owner"), q.get("limit"), co)}
        if (m, path) == ("POST", "/v1/work/next"):
            return self.work_next(co)
        if m == "GET" and path.startswith("/v1/work/"):
            return self.work_show(urllib.parse.unquote(path[len("/v1/work/"):]), co)
        if (m, path) == ("GET", "/v1/ask"):
            return {"hits": self.search(q.get("q"), q.get("kind"), q.get("limit"), co, timeout)}
        if (m, path) == ("POST", "/v1/ops"):
            return {"results": [self._old_op(o) for o in (b.get("ops") or [])]}
        raise RsError(404, f"{m} {path} has no equivalent on this ResultSpace server")

    def _old_op(self, o: dict) -> dict:
        """One entry of an old POST /v1/ops batch. Only `create` exists on the new server."""
        act = o.get("action") or {}
        if act.get("type") != "create":
            return {"op_id": o.get("op_id"),
                    "result": {"outcome": "rejected", "error": f"action {act.get('type')!r} is not supported"}}
        try:
            r = self.create_record(o.get("kind"), act.get("body") or {}, o.get("result"), o.get("why"),
                                   o.get("company_id"), idempotency_key=o.get("op_id"))
        except RsError as e:
            if e.status in (400, 403, 404, 409):  # the server refused this record: say so, as before
                return {"op_id": o.get("op_id"), "result": {"outcome": "rejected", "error": e.message}}
            raise
        return {"op_id": o.get("op_id"),
                "result": {"outcome": "applied", "id": r.get("id"), "key": r.get("key"), "rev": r.get("rev")}}

    def get(self, path: str, **query) -> Any:
        return self.request("GET", path, query=query)

    def post(self, path: str, body: Any = None) -> Any:
        return self.request("POST", path, body=body if body is not None else {})


class TTLCache:
    """Tiny cache for the guard (the permission check must stay fast)."""

    def __init__(self, ttl: float):
        self.ttl = ttl
        self._d: dict = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            v = self._d.get(key)
            if v and v[0] > time.monotonic():
                return v[1]
            self._d.pop(key, None)
            return None

    def put(self, key, value):
        with self._lock:
            self._d[key] = (time.monotonic() + self.ttl, value)

    def clear(self):
        with self._lock:
            self._d.clear()
