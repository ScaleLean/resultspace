"""Hermes knowledge integration. The runtime retains tools and execution ownership.

Only a company brief and explicit read/record tools. No hooks, heartbeat, dispatch,
action guard, approval transport, memory scraping, or SKILL.md installation.
"""
from __future__ import annotations
import json
import os
from .rsclient import Client, RsError, profile_of

BRIEF_BUDGET = 3500

def client(profile: str | None = None) -> Client:
    return Client.for_profile(profile or profile_of(os.environ.get("HERMES_HOME")))

def build_brief(profile: str | None = None, budget: int = BRIEF_BUDGET) -> str:
    return str(client(profile).brief(budget).get("text", ""))[:budget]

def _section(info):
    try:
        return build_brief(info.get("profile_name"))
    except RsError:
        return "ResultSpace context is unavailable. Continue with your runtime; fetch project context before relying on company claims."

def _read(args: dict, **_):
    try:
        c = client()
        if args.get("project"):
            result = c.project_context(args["project"], args.get("company"))
        elif args.get("ref"):
            result = c.op("record.context", {"ref": args["ref"]}, args.get("company"))
        else:
            result = c.search(args.get("query", ""), company=args.get("company"))
        return json.dumps(result)
    except RsError as e:
        return json.dumps({"error": e.message, "status": e.status})

def _record(args: dict, **_):
    try:
        return json.dumps(client().record_learning(args["project"], args["title"], args["detail"],
                         args["source"], args.get("company"), args.get("op_id")))
    except (RsError, KeyError) as e:
        return json.dumps({"error": str(e)})

READ_SCHEMA = {"name": "rs_context", "description": "Read focused project knowledge, a record with provenance, or search company knowledge",
    "parameters": {"type": "object", "properties": {"project": {"type": "string"}, "ref": {"type": "string"},
        "query": {"type": "string"}, "company": {"type": "string"}}}}
RECORD_SCHEMA = {"name": "rs_learn", "description": "Record sourced learning in a project after work in your own runtime",
    "parameters": {"type": "object", "properties": {k: {"type": "string"} for k in
        ["project", "title", "detail", "source", "company", "op_id"]}, "required": ["project", "title", "detail", "source"]}}

def register(ctx):
    ctx.register_system_prompt_section("resultspace.brief", _section, max_chars=4000)
    ctx.register_tool("rs_context", "resultspace", READ_SCHEMA, _read, description=READ_SCHEMA["description"], emoji="📖")
    ctx.register_tool("rs_learn", "resultspace", RECORD_SCHEMA, _record, description=RECORD_SCHEMA["description"], emoji="📝")
