"""Pure helpers for the ResultSpace memory provider: which lines are business facts.

The split: ResultSpace owns BUSINESS memory (decisions, goals, permissions, company facts,
customer and product knowledge). Hermes MEMORY.md and skills own CRAFT (how-to, tool quirks,
lessons). Only business facts are mirrored or extracted into ResultSpace, as `knowledge` records
marked agent-learned (a person can confirm, edit or delete them). Nothing is removed from MEMORY.md.
"""

from __future__ import annotations

import re

# Craft: how to use tools, commands, paths, environment quirks, preferences about working style.
_CRAFT = re.compile(
    r"(\b(run|use|call|invoke|pass|set|export|install|build|compile|restart|launch)\s+(the\s+)?`|"
    r"`[^`]+`|\b(command|cli|flag|--[a-z]|tool|api key|token|path|dir(ectory)?|repo|script|venv|"
    r"cargo|npm|pip|python|bash|systemd|(user|systemd|service|transient) units?|config(uration)?|profile|skill|prompt|model|provider|"
    r"timeout|retry|workaround|bug|quirk|pitfall|lesson|prefers? (short|concise|plain)|reply|replies|"
    r"respond|format|markdown|terminal|browser|ssh|port|localhost|127\.0\.0\.1)\b|~/|/home/|\.md\b|\.py\b|\.rs\b)",
    re.IGNORECASE,
)
# Business: companies, customers, products, prices, money, channels, decisions, goals, numbers.
_BUSINESS = re.compile(
    r"\b(customer|customers|buyer|buyers|audience|women|men|brand|product|products|sku|listing|offer|price|pricing|"
    r"sells?|sold|selling|buys?|bought|purchases?|"
    r"margin|revenue|sales|order|orders|aov|roas|cac|ltv|cpa|conversion|ad|ads|campaign|budget|spend|"
    r"supplier|vendor|manufacturer|competitor|market|niche|keyword|seo|amazon|shopify|ultracart|"
    r"wholesale|retail|subscription|churn|refund|review|reviews|ingredient|ingredients|dose|formula|"
    r"decided|decision|goal|target|kpi|launch|strategy|positioning|policy|compliance|fda|claims?)\b|"
    r"\$\s?\d|\d+\s?%",
    re.IGNORECASE,
)


def is_business_fact(text: str) -> bool:
    """A line worth keeping in ResultSpace (business), not in MEMORY.md (craft)."""
    t = " ".join((text or "").split())
    if len(t) < 12 or len(t) > 600:
        return False
    if _CRAFT.search(t):
        return False
    return bool(_BUSINESS.search(t))


def split_entries(text: str) -> list[str]:
    """MEMORY.md / USER.md entries: separated by '§' lines or blank lines; bullets stripped."""
    parts = re.split(r"\n\s*§\s*\n|\n\s*\n", text or "")
    out = []
    for p in parts:
        # Drop heading lines, then strip a leading bullet.
        lines = [ln for ln in p.strip().splitlines() if not ln.lstrip().startswith("#")]
        p = re.sub(r"^\s*[-*•]\s+", "", "\n".join(lines).strip())
        p = " ".join(p.split())
        if p:
            out.append(p)
    return out


def title_for(fact: str, n: int = 90) -> str:
    """A short Knowledge title from a fact (first sentence, trimmed)."""
    s = re.split(r"(?<=[.!?])\s", fact.strip(), maxsplit=1)[0]
    s = s.rstrip(".")
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


_TURN_FACT = re.compile(
    r"(?:^|\n|\.\s)((?:we|the owner|the company|our [a-z]+)\s+(?:decided|chose|agreed|will|won't|never|always|"
    r"prefers?|targets?|sells?|charges?|uses? [a-z]+ as)\b[^.\n]{8,240}[.])",
    re.IGNORECASE,
)


def facts_from_turn(user: str, assistant: str, limit: int = 3) -> list[str]:
    """Business facts stated in a turn (conservative: explicit decision/target sentences only)."""
    found = []
    for src in (user or "", assistant or ""):
        for m in _TURN_FACT.finditer(src):
            f = " ".join(m.group(1).split())
            if is_business_fact(f) and f not in found:
                found.append(f)
            if len(found) >= limit:
                return found
    return found
