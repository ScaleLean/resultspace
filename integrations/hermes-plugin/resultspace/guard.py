"""Classify a Hermes tool call as an outward action (or not).

Nothing is blocked; a match is only RECORDED in ResultSpace so people see what agents
did. A false "outward" costs one extra log line. The table is data and can be extended per profile through
`plugins.entries.resultspace.settings.guard_patterns` (list of {action, tool, pattern}).

Outward action types (the same ids ResultSpace uses): spend, ads, publish, email_customers,
message_customers, prices, ecommerce, deploy.

Anything run through `rs` itself is never outward (rs is how agents talk to ResultSpace, and
`rs act` records an outward action). Read-only commands (curl GET without a body, git status...)
are not outward.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ACTIONS = (
    "spend", "ads", "publish", "email_customers", "message_customers", "prices", "ecommerce", "deploy",
)


@dataclass(frozen=True)
class Pattern:
    action: str
    tool: str  # tool name, or "*" for shell/code/raw-HTTP tools
    regex: re.Pattern
    why: str
    write: bool = False  # an HTTP API endpoint: only counts when the call writes (not a GET)


def _p(action: str, tool: str, rx: str, why: str, write: bool = False) -> Pattern:
    return Pattern(action, tool, re.compile(rx, re.IGNORECASE), why, write)


# Tools whose argument is a shell command or code that can do anything.
COMMAND_TOOLS = ("terminal", "execute_code", "process_manage")
# Tools that make raw browser/HTTP calls: the generic patterns apply to them too.
RAW_TOOLS = ("browser_exec", "browser_cdp")

DEFAULT_PATTERNS: tuple[Pattern, ...] = (
    # --- deploy ------------------------------------------------------------------------------
    _p("deploy", "*", r"\bgit\s+push\b", "pushes code to a remote"),
    _p("deploy", "*", r"\b(vercel|netlify|flyctl|fly)\s+(deploy|--prod)\b|\bvercel\b.*--prod", "deploys a site"),
    _p("deploy", "*", r"\bkubectl\s+(apply|rollout|set\s+image|scale|delete)\b", "changes a cluster"),
    _p("deploy", "*", r"\b(terraform|tofu)\s+(apply|destroy)\b", "changes infrastructure"),
    _p("deploy", "*", r"\bdocker\s+(push|stack\s+deploy)\b", "ships a container"),
    _p("deploy", "*", r"\b(wrangler|cf)\s+(deploy|publish)\b|\bgh\s+release\s+create\b", "publishes a release"),
    _p("deploy", "*", r"\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b", "publishes a package"),
    # Stopping/disabling the live service or installing a new build is a deploy; (re)starting it is
    # recovery and must stay possible while ResultSpace is down (the guard fails closed then).
    _p("deploy", "*", r"\bpackaging/install\.sh\b|\bsystemctl\s+(--user\s+)?(stop|disable|mask)\s+resultspace", "changes a live service"),
    _p("deploy", "*", r"\bssh\b.+\b(systemctl|docker|deploy|restart)\b", "changes a remote server"),
    # --- ads -----------------------------------------------------------------------------------
    _p("ads", "*", r"graph\.facebook\.com/v?[\d.]*/?(act_\d+/)?(campaigns|adsets|ads|adcreatives)\b|/act_\d+/", "Meta ads API", True),
    _p("ads", "*", r"googleads\.googleapis\.com", "Google Ads API", True),
    _p("ads", "*", r"ads-api\.tiktok\.com|business-api\.tiktok\.com|advertising-api\.amazon\.com|api\.linkedin\.com/rest/adAccounts|ads-api\.(twitter|x)\.com", "ads API", True),
    _p("ads", "*", r"\b(daily_budget|lifetime_budget|bid_amount|campaign_budget|budget_micros)\s*[=:]", "sets an ad budget or bid"),
    # --- spend ---------------------------------------------------------------------------------
    _p("spend", "*", r"api\.stripe\.com/v1/(charges|payment_intents|transfers|payouts|invoices|subscriptions|refunds)", "Stripe money movement", True),
    _p("spend", "*", r"\bstripe\s+(charges|payment_intents|transfers|payouts|invoices|subscriptions|refunds)\s+create\b", "Stripe money movement"),
    _p("spend", "*", r"api(-m)?\.(sandbox\.)?paypal\.com/.*/(payments|payouts|orders)", "PayPal money movement", True),
    # --- email / message customers -------------------------------------------------------------
    _p("email_customers", "*", r"api\.(sendgrid|mailgun|postmarkapp|resend|sparkpost)\.(com|net)|\.api\.mailchimp\.com|a\.klaviyo\.com/api/(campaign|email|profile-subscription)|/v3/mail/send", "sends email", True),
    _p("email_customers", "*", r"\b(sendmail|msmtp|mutt|mailx?)\s|\bhimalaya\b.*\b(send|write|reply|forward)\b|\bsmtplib\b", "sends email"),
    _p("email_customers", "*", r"gmail\.googleapis\.com/.*/messages/send|\bgws\b.*\bgmail\b.*\bsend\b", "sends email"),
    _p("message_customers", "*", r"api\.twilio\.com/.*/Messages|api\.(textmagic|plivo|vonage|nexmo)\.com", "sends SMS", True),
    _p("message_customers", "*", r"graph\.facebook\.com/.*/messages\b|graph\.facebook\.com/.*/(comments|replies)\b", "sends a customer message", True),
    _p("message_customers", "*", r"(judge\.me|stamped\.io|yotpo\.com|trustpilot\.com).*\b(reply|replies|comment|respond)", "replies to a review", True),
    # --- publish -------------------------------------------------------------------------------
    _p("publish", "*", r"\bxurl\b.*\b(post|tweet|reply|quote)\b|\bbsky\b.*\bpost\b", "posts publicly"),
    _p("publish", "*", r"api\.(twitter|x)\.com/2/tweets", "posts publicly", True),
    _p("publish", "*", r"/wp-json/wp/v2/(posts|pages|media)\b", "publishes to WordPress", True),
    _p("publish", "*", r"myshopify\.com/admin/api/.*/(blogs|articles|pages)", "publishes to the store", True),
    _p("publish", "*", r"\b(published|publish|status)\s*[=:]\s*['\"]?(true|publish(ed)?|live)\b", "sets something live"),
    # --- prices / store settings ---------------------------------------------------------------
    _p("prices", "*", r"myshopify\.com/admin/api/.*/(products|variants|price_rules|discount_codes)", "changes prices/discounts", True),
    _p("prices", "*", r"\b(compare_at_price|price_rule|discount_code|coupon_code)\s*[=:]", "changes a price or coupon"),
    _p("prices", "*", r"ultracart\.com/rest/.*/(item|coupon)", "changes an UltraCart item/coupon", True),
    _p("ecommerce", "*", r"myshopify\.com/admin/api/.*/(shipping|checkouts|inventory_levels|locations|shop|themes|fulfillments)", "changes store settings", True),
    _p("ecommerce", "*", r"ultracart\.com/rest/.*/(storefront|checkout|shipping|fulfillment|order)", "changes UltraCart settings", True),
    # --- tools that are outward by nature ------------------------------------------------------
    _p("message_customers", "send_message", r".", "sends a message on a chat platform"),
)

# Clearly read-only shell commands never count (cheap pre-filter; the table above is what matters).
_READONLY = re.compile(
    r"^\s*(ls|cat|head|tail|grep|rg|find|wc|echo|pwd|git\s+(status|log|diff|show|branch|fetch|remote\s+-v)|rs\s)",
    re.IGNORECASE,
)
# An HTTP call writes when it has a body or a non-GET method (curl/wget/httpie/python/js).
_HTTP_WRITES = re.compile(
    r"(-X\s*(POST|PUT|PATCH|DELETE)|--request\s+(POST|PUT|PATCH|DELETE)|\s(-d|--data\S*|-F|--form|--json|--upload-file)\b|\b(POST|PUT|PATCH|DELETE)\s+https?://|requests\.(post|put|patch|delete)|method\s*[:=]\s*['\"](POST|PUT|PATCH|DELETE))",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Outward:
    action: str
    why: str
    detail: str  # what a person reads in the Request (short, secrets stripped)


def _text_of(tool: str, args: dict) -> str:
    if not isinstance(args, dict):
        return ""
    for k in ("command", "code", "input", "script", "cmd", "url"):
        v = args.get(k)
        if isinstance(v, str) and v.strip():
            return v
    try:
        import json

        return json.dumps(args, sort_keys=True)[:4000]
    except Exception:
        return str(args)[:4000]


_SECRET = re.compile(
    r"(rsn_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]+|xox[abp]-[A-Za-z0-9-]+|"
    r"(?i:bearer)\s+[A-Za-z0-9._~+/=-]+|(?i:(password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*)\S+|"
    r"[A-Za-z0-9_-]{32,})"
)


def redact(s: str) -> str:
    return _SECRET.sub("[redacted]", s)


def short(s: str, n: int = 220) -> str:
    s = " ".join(redact(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def is_rs_command(text: str) -> bool:
    """`rs ...` (including `rs act`) and pipelines made only of rs calls are ResultSpace itself."""
    parts = [p.strip() for p in re.split(r"&&|\|\||;|\|", text) if p.strip()]
    return bool(parts) and all(re.match(r"^(\S+/)?rs(\s|$)", p) for p in parts)


def classify(tool: str, args: dict, extra: tuple[Pattern, ...] = ()) -> Outward | None:
    """The outward action this tool call would take, or None."""
    text = _text_of(tool, args)
    if tool in COMMAND_TOOLS:
        if not text.strip() or is_rs_command(text):
            return None
        if _READONLY.match(text) and not re.search(r"[;&|`$]", text):
            return None
    writes = bool(_HTTP_WRITES.search(text))
    for pat in (*extra, *DEFAULT_PATTERNS):
        if pat.tool == "*":
            # Generic patterns look at shell/code and raw browser/HTTP calls only; other tools
            # match their own explicit entries.
            if tool not in COMMAND_TOOLS and tool not in RAW_TOOLS:
                continue
        elif pat.tool != tool:
            continue
        if not pat.regex.search(text):
            continue
        if pat.write and not writes:
            continue  # reading an API (GET) is not outward
        return Outward(pat.action, pat.why, f"{pat.why}: {short(text)}")
    return None


def patterns_from_config(items) -> tuple[Pattern, ...]:
    """Extra patterns from settings: [{action, tool?, pattern, why?}] (bad entries are skipped)."""
    out = []
    for it in items or []:
        try:
            a = str(it["action"])
            if a not in ACTIONS:
                continue
            out.append(_p(a, str(it.get("tool") or "*"), str(it["pattern"]),
                          str(it.get("why") or "matches a configured pattern"), bool(it.get("write", False))))
        except Exception:
            continue
    return tuple(out)
