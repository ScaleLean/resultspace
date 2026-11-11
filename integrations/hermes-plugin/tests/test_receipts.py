"""Receipt hook status regressions; no Hermes, server, or network needed."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import resultspace as plugin


class ReceiptStatus(unittest.TestCase):
    def check_status(self, status, expected):
        with patch.object(plugin, "S", plugin._State()):
            self.assertIsNone(plugin._post_tool_call(tool_name="terminal", status=status, session_id="receipt-test"))
            self.assertEqual(plugin.S.receipts["receipt-test"], [f"terminal {expected}"])

    def test_missing_status_is_unknown(self):
        self.check_status(None, "unknown")

    def test_explicit_success_is_ok(self):
        for status in ("ok", "success", "completed", "SUCCESS"):
            with self.subTest(status=status):
                self.check_status(status, "ok")

    def test_failure_stays_failed(self):
        for status in ("failed", "error"):
            with self.subTest(status=status):
                self.check_status(status, "failed")
