"""Read focused ResultSpace knowledge and explicitly record sourced learning. No runtime hooks."""
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
    """Authenticated knowledge client, one key per company."""

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

    def project_context(self, ref: str, company: str | None = None) -> dict:
        return self.op("project.context", {"ref": ref}, company)

    def record_learning(self, project: str, title: str, detail: str, source: str,
                        company: str | None = None, idempotency_key: str | None = None) -> dict:
        if not source.strip():
            raise RsError(0, "Learning needs a source citation")
        return self.op("journal.log", {"project": project, "title": title, "detail": detail,
                       "source": source, "type": "learning"}, company, idempotency_key=idempotency_key)

    def search(self, q: str, kind: str | None = None, limit: int | None = None,
               company: str | None = None, timeout: float | None = None) -> list[dict]:
        return list(self.op("record.search", _pick({"q": q, "kind": kind, "limit": limit}, "q", "kind", "limit"),
                            company, timeout) or [])

    def create_record(self, kind: str, body: dict, result: str | None = None, why: str | None = None,
                      company: str | None = None, idempotency_key: str | None = None) -> dict:
        inp = {"kind": kind, "body": body, **_pick({"result": result, "why": why}, "result", "why")}
        return self.op("record.create", inp, company, idempotency_key=idempotency_key) or {}

    # ------------------------------------------------------------------ the routes the plugins use
