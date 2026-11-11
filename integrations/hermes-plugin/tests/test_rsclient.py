"""End to end: rsclient (and the plugin code that calls it) against the real ResultSpace server.

Starts `node src/server.ts` on 127.0.0.1 with a temporary data dir. Stdlib only.
    cd integrations/hermes-plugin && python3 -m unittest discover -s tests -v
"""
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import types
import unittest
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGINS = HERE.parent
ROOT = PLUGINS.parent.parent  # the repository root (src/server.ts, src/admin.ts)

sys.path.insert(0, str(PLUGINS))
import resultspace as plugin  # noqa: E402  (the general plugin; needs no Hermes to import)
from resultspace import rsclient  # noqa: E402


def _load_memory_plugin():
    """The memory plugin subclasses a Hermes class: give it a stand-in so it imports here."""
    agent = types.ModuleType("agent")
    mp = types.ModuleType("agent.memory_provider")
    mp.MemoryProvider = type("MemoryProvider", (), {})
    sys.modules.setdefault("agent", agent)
    sys.modules.setdefault("agent.memory_provider", mp)
    d = PLUGINS / "resultspace-memory"
    spec = importlib.util.spec_from_file_location("resultspace_memory", d / "__init__.py",
                                                  submodule_search_locations=[str(d)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["resultspace_memory"] = mod
    spec.loader.exec_module(mod)
    return mod


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="rs-plugin-test-"))
        cls.env = {**os.environ, "DATA_DIR": str(cls.tmp / "data")}
        cls.env.pop("RS_WORK_ORDER", None)
        cls.env.pop("RS_ASSIGNMENT", None)

        def admin(*a):
            subprocess.run(["node", "src/admin.ts", *a], cwd=ROOT, env=cls.env, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)

        admin("company", "create", "acme", "Acme")
        admin("agent", "add", "acme", "hermes:acme", "member")
        admin("agent", "key", "acme", "hermes:acme", "--out", str(cls.tmp / "acme.key"))
        admin("agent", "add", "acme", "boss", "admin")
        admin("agent", "key", "acme", "boss", "--out", str(cls.tmp / "boss.key"))
        for k in ("acme.key", "boss.key"):
            os.chmod(cls.tmp / k, 0o600)

        cls.port = _free_port()
        cls.url = f"http://127.0.0.1:{cls.port}"
        cls.proc = subprocess.Popen(["node", "src/server.ts"], cwd=ROOT, env={**cls.env, "PORT": str(cls.port)},
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with urllib.request.urlopen(cls.url + "/health", timeout=1) as r:
                    if json.loads(r.read()).get("ok"):
                        break
            except OSError:
                time.sleep(0.1)
        else:
            cls.tearDownClass()
            raise RuntimeError("the server did not answer /health")

        cls.cfg = cls.tmp / "cli.toml"
        cls.cfg.write_text(f'server_url = "{cls.url}"\ndefault_company = "acme"\n'
                           f'[companies.acme]\nkey_file = "{cls.tmp / "acme.key"}"\n')
        os.environ["RS_CONFIG"] = str(cls.cfg)
        os.environ["RS_PROFILE"] = "acme"
        cls.c = rsclient.Client.for_profile("acme")
        cls.boss = rsclient.Client(cls.url, {"acme": cls.tmp / "boss.key"})
        cls.order = cls.boss.create_record("work_order", {"title": "Count the widgets", "owner": "hermes:acme",
                                                          "brief": "Count them and report the number."})

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
        os.environ.pop("RS_CONFIG", None)
        os.environ.pop("RS_PROFILE", None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ---- identity
    def test_me(self):
        me = self.c.me()
        self.assertEqual(me["actor"]["name"], "hermes:acme")
        self.assertEqual(me["actor"]["role"], "member")
        self.assertEqual(me["company"]["slug"], "acme")
        self.assertEqual(self.c.get("/v1/me")["company"]["slug"], "acme")
        # the shape the status line reads
        self.assertEqual([(x["slug"], x["role"]) for x in self.c.companies()], [("acme", "member")])

    def test_company_id_is_a_slug(self):
        self.assertEqual(self.c.company_id(), "acme")
        self.assertEqual(self.c.company_id("acme"), "acme")
        self.assertIsNone(self.c.company_id("other"))
        only = rsclient.Client(self.url, {"acme": self.tmp / "acme.key"})
        self.assertEqual(only.company_id(), "acme")  # the only configured company

    # ---- brief
    def test_brief(self):
        b = self.c.get("/v1/brief", budget=2000)
        self.assertTrue(b["text"])
        self.assertEqual(self.c.brief()["company"], b["company"])
        self.assertIn("hermes:acme", plugin.build_brief("acme", 2000))  # the plugin's own path

    # ---- outward actions
    def test_permission_check_records_an_action(self):
        r = self.c.post("/v1/permissions/check", {"company_id": "acme", "action": "publish",
                                                  "detail": "Blog post about widgets", "guard": True})
        self.assertEqual(r["decision"], "allow")
        self.assertTrue(r["key"])
        r = plugin.check_outward("spend", "Ad budget", 25, "USD", self.order["key"])
        self.assertEqual(r["decision"], "allow")
        shown = self.c.work_show(self.order["key"])
        self.assertIn(r["key"], [a["key"] for a in shown["actions"]])  # tied to the work order

    def test_bad_action_is_an_rserror_400(self):
        with self.assertRaises(rsclient.RsError) as cm:
            self.c.record_action("fly_to_moon", "x")
        self.assertEqual(cm.exception.status, 400)
        self.assertTrue(cm.exception.message)

    # ---- receipts and presence
    def test_receipt(self):
        r = self.c.post("/v1/agents/receipts", {"company_id": "acme", "work_order": None, "session": "sess-1",
                                                "summary": "2 steps: read; write", "detail": {"steps": 2}})
        self.assertTrue(r["ok"])
        self.assertTrue(r["key"])
        r = self.c.receipt("1 step: counted", session="sess-1", work_order=self.order["key"],
                           detail={"steps": 1, "nested": {"dropped": True}})
        self.assertTrue(r["ok"])

    def test_presence(self):
        self.assertTrue(self.c.post("/v1/agents/presence", {"session": "sess-1"})["ok"])
        self.assertTrue(self.c.presence("live")["ok"])

    # ---- work orders
    def test_work_list_next_show(self):
        lst = self.c.get("/v1/work")
        mine = [w for w in lst["work_orders"] if w["key"] == self.order["key"]]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["title"], "Count the widgets")
        self.assertEqual(mine[0]["owner"], "hermes:acme")

        nxt = self.c.post("/v1/work/next", {"run": None})
        self.assertEqual(nxt["work_order"]["key"], self.order["key"])
        self.assertTrue(nxt["work_order"]["id"])

        for ref in (self.order["key"], nxt["work_order"]["id"]):
            shown = self.c.get(f"/v1/work/{ref}")
            self.assertEqual(shown["title"], "Count the widgets")
            for part in ("results", "receipts", "actions"):
                self.assertIn(part, shown)

    # ---- assignments (the new names)
    def test_assignment_claim_show_and_linked_records(self):
        a = self.boss.create_record("assignment", {"title": "Weigh the widgets", "owner": "hermes:acme"})
        self.assertTrue(a["key"].startswith("ASG-"))
        self.assertIn(a["key"], [x["key"] for x in self.c.assignment_list()])
        claimed = self.c.assignment_claim(a["key"])
        self.assertEqual(claimed["status"], "picked_up")
        r = plugin.check_outward("spend", "Bought a scale", 30, "USD", a["key"])
        self.c.receipt("1 step: weighed", session="sess-2", assignment=a["key"])
        shown = self.c.assignment_show(a["key"])
        self.assertIn(r["key"], [x["key"] for x in shown["actions"]])
        self.assertEqual(len(shown["sessions"]), 1)
        self.assertEqual(shown["verification"]["state"], "not_verified")
        old = self.c.work_show(a["key"])  # the old name answers in the old shape
        self.assertEqual(len(old["receipts"]), 1)
        out = json.loads(plugin._tool_work({"op": "show", "id": a["key"]}))
        self.assertEqual(out["key"], a["key"])

    def test_assignment_falls_back_to_work_ops_on_an_older_server(self):
        c = rsclient.Client.for_profile("acme")
        real = c.op
        calls = []

        def old_server(name, input=None, company=None, timeout=None, idempotency_key=None):
            calls.append(name)
            if name.startswith("assignment."):
                raise rsclient.RsError(404, f"no operation {name}")
            if name == "work.next":  # what an older server answers (not sent: it would claim the shared order)
                return {"work_order": {"key": "WO-0009", "id": "x"}, "claimed": True}
            return real(name, input, company, timeout, idempotency_key)

        c.op = old_server
        self.assertIsInstance(c.assignment_list(), list)
        self.assertEqual(c.assignment_next(), {"assignment": {"key": "WO-0009", "id": "x"}, "claimed": True})
        self.assertEqual(calls, ["assignment.list", "work.list", "assignment.next", "work.next"])
        with self.assertRaises(rsclient.RsError):  # a real not-found is not swallowed
            self.c.assignment_show("ASG-99999")

    def test_work_show_unknown_is_404(self):
        with self.assertRaises(rsclient.RsError) as cm:
            self.c.work_show("WO-99999")
        self.assertEqual(cm.exception.status, 404)

    # ---- memory: remember, then ask
    def test_remember_then_ask(self):
        body = {"title": "Zanzibar shipping rule", "body": "Orders to Zanzibar ship on Tuesdays only.",
                "status": "agent_learned", "collection": "agent-learned",
                "source": {"session": "sess-1", "agent": "hermes:acme", "via": "test"}, "tags": ["agent-learned"]}
        op = {"op_id": "11111111-2222-3333-4444-555555555555", "company_id": "acme", "entity_id": "x",
              "kind": "knowledge", "base_rev": None, "action": {"type": "create", "body": body},
              "result": "Learned: Zanzibar shipping rule"}
        r = self.c.post("/v1/ops", {"ops": [op]})
        res = r["results"][0]["result"]
        self.assertEqual(res["outcome"], "applied")
        again = self.c.post("/v1/ops", {"ops": [op]})["results"][0]["result"]
        self.assertEqual(again["key"], res["key"])  # the op_id makes a repeat safe

        hits = self.c.request("GET", "/v1/ask", query={"q": "Zanzibar", "limit": 5}, timeout=3.0)["hits"]
        mine = [h for h in hits if h["key"] == res["key"]]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["kind"], "knowledge")
        self.assertEqual(mine[0]["title"], "Zanzibar shipping rule")
        self.assertEqual(len(self.c.search("Zanzibar", kind="work_order")), 0)

    def test_memory_plugin_remember_and_ask(self):
        mem = _load_memory_plugin()
        p = mem.ResultSpaceMemory()
        p.initialize("sess-mem", agent_identity="acme")
        out = p._remember("The Quokka plan renews on the 3rd of each month.", None, origin="rs_remember")
        self.assertTrue(out["ok"], out)
        self.assertTrue(any("Quokka" in json.dumps(h) for h in p._ask("Quokka", 5)))

    def test_unsupported_old_calls(self):
        r = self.c.post("/v1/ops", {"ops": [{"op_id": "abcdefgh", "kind": "knowledge", "action": {"type": "delete"}}]})
        self.assertEqual(r["results"][0]["result"]["outcome"], "rejected")
        with self.assertRaises(rsclient.RsError) as cm:
            self.c.post("/v1/agents/token", {})
        self.assertEqual(cm.exception.status, 404)

    # ---- failures never escape as anything but RsError
    def test_missing_key_file(self):
        c = rsclient.Client(self.url, {"acme": self.tmp / "nope.key"}, "acme")
        with self.assertRaises(rsclient.RsError) as cm:
            c.me()
        self.assertEqual(cm.exception.status, 0)
        self.assertIn("key file", cm.exception.message)

    def test_key_file_must_be_private(self):
        loose = self.tmp / "loose.key"
        shutil.copy(self.tmp / "acme.key", loose)
        os.chmod(loose, 0o644)
        with self.assertRaises(rsclient.RsError) as cm:
            rsclient.Client(self.url, {"acme": loose}).brief()
        self.assertIn("chmod 600", cm.exception.message)

    def test_wrong_key_is_401(self):
        bad = self.tmp / "bad.key"
        bad.write_text("rsk_acme_notarealsecret\n")
        os.chmod(bad, 0o600)
        with self.assertRaises(rsclient.RsError) as cm:
            rsclient.Client(self.url, {"acme": bad}).me()
        self.assertEqual(cm.exception.status, 401)

    def test_unreachable_server(self):
        c = rsclient.Client(f"http://127.0.0.1:{_free_port()}", {"acme": self.tmp / "acme.key"}, timeout=1.0)
        with self.assertRaises(rsclient.RsError) as cm:
            c.work_list()
        self.assertEqual(cm.exception.status, 0)
        self.assertIn("unreachable", cm.exception.message)

    def test_config_errors(self):
        with self.assertRaises(rsclient.RsError):
            rsclient.Client.for_profile("x", env={"RS_CONFIG": str(self.tmp / "missing.toml")})
        old = self.tmp / "old.toml"
        old.write_text(f'server_url = "{self.url}"\ntoken_file = "/tmp/t"\n')
        with self.assertRaises(rsclient.RsError) as cm:
            rsclient.Client.for_profile("x", env={"RS_CONFIG": str(old)})
        self.assertIn("key_file", cm.exception.message)

    def test_profile_and_config_lookup(self):
        self.assertEqual(rsclient.profile_of("/home/u/.hermes/profiles/acme"), "acme")
        self.assertEqual(rsclient.profile_of("/home/u/.hermes"), "default")
        self.assertEqual(rsclient.profile_of(None), "default")
        self.assertEqual(rsclient.config_path("p", {"XDG_CONFIG_HOME": "/nonexistent"}),
                         Path("/nonexistent/resultspace/cli.toml"))


if __name__ == "__main__":
    unittest.main()
