"""The business-vs-craft split used by the memory provider (pure; no Hermes, no network)."""

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rs_facts", HERE.parent / "resultspace-memory" / "facts.py")
facts = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
sys.modules["rs_facts"] = facts
spec.loader.exec_module(facts)  # type: ignore[union-attr]


class BusinessOrCraft(unittest.TestCase):
    def test_business_facts(self):
        for f in [
            "Calm Blend sells best to women 35-55 who already take magnesium.",
            "We decided to keep the Calm Blend price at $39 through Q4.",
            "Northwind wholesale margin target is 40%.",
            "Acme's main competitor on Amazon is Natrol.",
            "Calm Blend wholesale price is $22 per unit for Northwind.",
        ]:
            self.assertTrue(facts.is_business_fact(f), f)

    def test_craft_stays_in_memory_md(self):
        for f in [
            "Rust toolchain is at ~/.cargo/bin (not on default PATH).",
            "Run `rs work next` before anything else.",
            "Alex prefers replies in English and short status answers.",
            "The Windsor API times out after 30s; retry with backoff.",
            "Headless GTK4 runs need gtk4-broadwayd on a private display.",
            "The build lead runs as a transient systemd user unit.",
            "short",
        ]:
            self.assertFalse(facts.is_business_fact(f), f)

    def test_split_entries_handles_section_markers(self):
        md = "First fact about customers.\n§\nSecond: price is $39.\n\n- bullet about ads budget\n# Heading"
        self.assertEqual(facts.split_entries(md), ["First fact about customers.", "Second: price is $39.", "bullet about ads budget"])

    def test_turn_extraction_is_conservative(self):
        got = facts.facts_from_turn("OK. We decided to cap the Calm Blend ad budget at $60/day for October.", "Done, I'll keep that in mind.")
        self.assertEqual(got, ["We decided to cap the Calm Blend ad budget at $60/day for October."])
        self.assertEqual(facts.facts_from_turn("can you run the tests?", "All 12 tests pass."), [])

    def test_titles_are_short(self):
        self.assertEqual(facts.title_for("Calm Blend sells best to women 35-55. They buy twice."), "Calm Blend sells best to women 35-55")
        self.assertLessEqual(len(facts.title_for("x" * 300)), 90)


if __name__ == "__main__":
    unittest.main()
