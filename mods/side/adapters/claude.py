"""Claude Code: a running claude writes ~/.claude/sessions/<pid>.json (sessionId, cwd); Herdr's foreground pid may
be a shell above it, so the process tree is walked. A side chat is a fresh session (empty screen, original untouched)
given the conversation as background: `--append-system-prompt-file` with the side-chat instruction, the latest
compaction summary and the most recent exchanges, plus the path of a plain-text digest of the whole conversation it
can read when asked about something older. Files, never argv: argv shows in `ps`. Answer-only adds plan mode."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import glob
import json
import os

from .chat import carried, digest, recent, write_chat  # noqa: F401 (digest, recent: tests)

NAME = "Claude Code"
CARRY = ("--model", "--effort")  # the copy talks to the same model; every other flag is dropped


def caps() -> dict:
    return {"locate": "exact", "full": True, "before": None, "answerOnly": "enforced"}


def _owner(req: dict, env) -> tuple:
    """(the process that owns a session file, its session json) under the pane's pid, or (None, None)."""
    for p in env.procs(int(req["pid"])):
        f = os.path.join(env.home, ".claude", "sessions", f"{p.pid}.json")
        if os.path.exists(f):
            with open(f) as fh:
                return p, json.load(fh)
    return None, None


def locate(req: dict, env) -> dict:
    p, s = _owner(req, env)
    if not s or not s.get("sessionId"):
        return {"error": {"code": "not-found", "message": "no ~/.claude/sessions/<pid>.json under this pane"}}
    # The pid file exists from start, the transcript only from the first prompt: before that there is nothing to copy.
    if not glob.glob(os.path.join(env.home, ".claude", "projects", "*", f"{s['sessionId']}.jsonl")):
        return {"error": {"code": "not-found", "message": "this Claude session has no conversation yet"}}
    return {"session": {"harness": "claude", "id": s["sessionId"], "cwd": s.get("cwd") or req.get("cwd")},
            "confidence": "exact", "why": f"~/.claude/sessions/{p.pid}.json"}


def entries(lines) -> tuple:
    """Transcript lines -> ([(role, text)], latest compaction summary or None). Only what was said: no tool results,
    meta records, sidechains, slash-command wrappers or thinking; a tool use is one "[used <name>]" line."""
    out, summary = [], None
    for line in lines:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("type") not in ("user", "assistant") or o.get("isSidechain") or o.get("isMeta"):
            continue
        c = (o.get("message") or {}).get("content")
        parts = [{"type": "text", "text": c}] if isinstance(c, str) else c if isinstance(c, list) else []
        for p in parts:
            if not isinstance(p, dict):
                continue
            if o["type"] == "user" and p.get("type") == "text":
                text = p.get("text") or ""
                if o.get("isCompactSummary"):
                    summary = text
                elif text.strip() and not text.startswith(("<command-", "<local-command-")):
                    out.append(("user", text))
            elif o["type"] == "assistant" and p.get("type") == "text" and (p.get("text") or "").strip():
                out.append(("agent", p["text"]))
            elif o["type"] == "assistant" and p.get("type") == "tool_use":
                out.append(("agent", f"[used {p.get('name')}]"))
    return out, summary


def copy(req: dict, env) -> dict:
    p, _ = _owner(req, env)
    args = p.args if p and p.args else ["claude"]
    # ps splits a path with spaces (the desktop app's "…/Application Support/…"): then run claude from PATH
    prog = args[0] if "/" not in args[0] or os.path.exists(args[0]) else "claude"
    sid = req["session"]["id"]
    found = glob.glob(os.path.join(env.home, ".claude", "projects", "*", f"{sid}.jsonl"))
    if not found:
        return {"error": {"code": "not-found", "message": "this Claude session has no conversation yet"}}
    with open(found[0], encoding="utf-8") as f:
        es, summary = entries(f)
    bg = write_chat(sid, es, summary, req["dataDir"])
    mode = ["--permission-mode", "plan"] if req.get("answerOnly") else []
    argv = [prog, *mode, "--append-system-prompt-file", bg, *carried(args, CARRY)]
    return {"launch": {"argv": argv, "cwd": req["session"]["cwd"]}, "note": None if req.get("answerOnly") else "can-edit"}
