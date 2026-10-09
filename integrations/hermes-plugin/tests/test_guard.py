"""Unit tests for the outward-action classifier (no Hermes, no network).

Run: python3 -m unittest discover -s integrations/hermes-plugin/tests -v
"""

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rs_guard", HERE.parent / "resultspace" / "guard.py")
guard = importlib.util.module_from_spec(spec)
sys.modules["rs_guard"] = guard
spec.loader.exec_module(guard)


def cls(tool, **args):
    o = guard.classify(tool, args)
    return o.action if o else None


class OutwardActions(unittest.TestCase):
    def test_spend_money(self):
        self.assertEqual(cls("terminal", command="curl -X POST https://api.stripe.com/v1/payment_intents -d amount=6000"), "spend")
        self.assertEqual(cls("terminal", command="stripe payouts create --amount 5000"), "spend")

    def test_ads(self):
        self.assertEqual(cls("terminal", command="curl -X POST 'https://graph.facebook.com/v19.0/act_123/campaigns' -F daily_budget=6000"), "ads")
        self.assertEqual(cls("execute_code", code="requests.post('https://googleads.googleapis.com/v17/customers/1/campaignBudgets:mutate', json=b)"), "ads")
        self.assertEqual(cls("execute_code", code="campaign.daily_budget = 6000\ncampaign.save()"), "ads")

    def test_publish(self):
        self.assertEqual(cls("terminal", command="xurl post 'New Calm Blend results'"), "publish")
        self.assertEqual(cls("terminal", command="curl -X POST https://example.com/wp-json/wp/v2/posts -d @post.json"), "publish")

    def test_email_and_message_customers(self):
        self.assertEqual(cls("terminal", command="curl -X POST https://api.sendgrid.com/v3/mail/send --data @m.json"), "email_customers")
        self.assertEqual(cls("terminal", command="himalaya message send < draft.eml"), "email_customers")
        self.assertEqual(cls("execute_code", code="import smtplib\ns=smtplib.SMTP('smtp.x')"), "email_customers")
        self.assertEqual(cls("terminal", command="curl -X POST https://api.twilio.com/2010-04-01/Accounts/A/Messages.json -d To=+1"), "message_customers")
        self.assertEqual(cls("send_message", target="telegram:123", message="hi"), "message_customers")

    def test_prices_and_store_settings(self):
        self.assertEqual(cls("terminal", command="curl -X PUT https://shop.myshopify.com/admin/api/2024-07/variants/1.json -d '{\"variant\":{\"price\":\"29\"}}'"), "prices")
        self.assertEqual(cls("terminal", command="curl -X PUT https://secure.ultracart.com/rest/v2/item/items/SLEEP -d @i.json"), "prices")
        self.assertEqual(cls("terminal", command="curl -X PUT https://shop.myshopify.com/admin/api/2024-07/shipping_zones.json -d @z"), "ecommerce")

    def test_deploy(self):
        self.assertEqual(cls("terminal", command="git push origin main"), "deploy")
        self.assertEqual(cls("terminal", command="cd site && vercel --prod"), "deploy")
        self.assertEqual(cls("terminal", command="systemctl --user disable resultspace-native-server"), "deploy")
        self.assertEqual(cls("terminal", command="systemctl --user stop resultspace-native.target"), "deploy")
        self.assertEqual(cls("terminal", command="npm publish"), "deploy")


class NotOutward(unittest.TestCase):
    def test_reads_are_not_outward(self):
        self.assertIsNone(cls("terminal", command="curl https://api.stripe.com/v1/charges -u sk_test_x:"))
        self.assertIsNone(cls("terminal", command="curl 'https://graph.facebook.com/v19.0/act_123/insights?fields=spend'"))
        self.assertIsNone(cls("terminal", command="curl -s https://secure.ultracart.com/rest/v2/order/orders?limit=5"))
        self.assertIsNone(cls("terminal", command="git status"))
        self.assertIsNone(cls("terminal", command="git log --oneline -5"))
        self.assertIsNone(cls("terminal", command="ls -la"))

    def test_restarting_a_down_service_is_not_a_deploy(self):
        # The guard fails closed when ResultSpace is unreachable; restarting it must stay possible.
        self.assertIsNone(cls("terminal", command="systemctl --user restart resultspace-native-server"))
        self.assertIsNone(cls("terminal", command="systemctl --user start resultspace-native.target"))

    def test_rs_itself_is_never_outward(self):
        self.assertIsNone(cls("terminal", command='rs act ads --detail "raise the budget" --amount 60'))
        self.assertIsNone(cls("terminal", command='rs work report WO-0001 --result "ads live at $60/day"'))
        self.assertIsNone(cls("terminal", command="rs work next && rs brief"))
        self.assertIsNone(cls("terminal", command='rs assignment report ASG-0001 --result "ads live at $60/day"'))
        self.assertIsNone(cls("terminal", command="rs assignment claim ASG-0001 && rs brief"))

    def test_a_pipeline_that_sneaks_a_push_is_caught(self):
        self.assertEqual(cls("terminal", command="rs work next && git push origin main"), "deploy")
        self.assertEqual(cls("terminal", command="ls; git push"), "deploy")

    def test_ordinary_tools_are_not_outward(self):
        self.assertIsNone(cls("read_file", path="/tmp/x"))
        self.assertIsNone(cls("web_search", query="stripe payouts api"))
        self.assertIsNone(cls("web_extract", urls=["https://api.stripe.com/docs"]))


class Redaction(unittest.TestCase):
    def test_details_never_carry_secrets(self):
        o = guard.classify("terminal", {"command": "curl -X POST https://api.sendgrid.com/v3/mail/send -H 'Authorization: Bearer SG.abcdefghijklmnopqrstuvwxyz0123456789' -d @m"})
        self.assertIsNotNone(o)
        self.assertNotIn("SG.abcdefghijklmnopqrstuvwxyz0123456789", o.detail)
        self.assertIn("[redacted]", o.detail)
        self.assertNotIn("rsn_abc", guard.short("token=rsn_abcdefghijklmnopqrstuvwxyz"))
        self.assertLessEqual(len(guard.short("x " * 500)), 220)


class ConfiguredPatterns(unittest.TestCase):
    def test_extra_patterns_from_settings(self):
        extra = guard.patterns_from_config([
            {"action": "publish", "pattern": r"\bmy-publish-tool\b"},
            {"action": "not-an-action", "pattern": "x"},
            {"pattern": "missing action"},
        ])
        self.assertEqual(len(extra), 1)
        o = guard.classify("terminal", {"command": "my-publish-tool --live"}, extra)
        self.assertEqual(o.action, "publish")



class NeverBlocks(unittest.TestCase):
    """The plugin's pre_tool_call hook records outward actions and never blocks."""

    def test_pre_tool_call_returns_none_for_outward_actions_even_when_unreachable(self):
        import types
        pkg = types.ModuleType("rs_plugin_pkg")
        pkg.__path__ = [str(HERE.parent / "resultspace")]
        sys.modules["rs_plugin_pkg"] = pkg
        spec2 = importlib.util.spec_from_file_location(
            "rs_plugin_pkg", HERE.parent / "resultspace" / "__init__.py",
            submodule_search_locations=[str(HERE.parent / "resultspace")])
        mod = importlib.util.module_from_spec(spec2)
        sys.modules["rs_plugin_pkg"] = mod
        try:
            spec2.loader.exec_module(mod)
        except Exception as e:  # the plugin imports Hermes-only modules in some versions
            self.skipTest(f"plugin needs Hermes to import: {e}")
        calls = []

        def unreachable(*a, **k):
            calls.append(a)
            raise mod.RsError("unreachable") if hasattr(mod, "RsError") else RuntimeError("x")

        mod.check_outward = unreachable
        for cmd in ("curl -X POST https://api.stripe.com/v1/payment_intents -d amount=6000",
                    "git push origin main", "ls -la"):
            self.assertIsNone(mod._pre_tool_call(tool_name="terminal", args={"command": cmd}, session_id="t"))
        self.assertEqual(len(calls), 2)  # the two outward calls were offered for recording


if __name__ == "__main__":
    unittest.main()
