"""pi: sessions are ~/.pi/agent/sessions/--<cwd with / as ->--/<time>_<id>.jsonl, and a running pi names its file
nowhere but its argv (--session <path|id prefix>); otherwise the folder's most recently written file is a guess. A
side chat is a fresh pi given the conversation as background (pi_format); answer-only allows only pi's read tools
(--tools drops every other tool, extensions' too, from its registry)."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import glob
import os
import re

from . import pi_format

NAME = "pi"


def caps() -> dict:
    return {"locate": "guess", "full": True, "before": None, "answerOnly": "enforced"}


def _session_arg(args: list[str]) -> str | None:
    for i, a in enumerate(args):
        if a == "--session" and i + 1 < len(args):
            return args[i + 1]
        if a.startswith("--session="):
            return a.split("=", 1)[1]
    return None


def _found(file: str, cwd: str, confidence: str, why: str) -> dict:
    return {"session": {"harness": "pi", "id": pi_format.session_id(file), "file": file, "cwd": cwd},
            "confidence": confidence, "why": why}


def locate(req: dict, env) -> dict:
    cwd = req.get("cwd") or ""
    root = os.path.join(env.home, ".pi", "agent", "sessions")
    for p in env.procs(int(req["pid"])):
        s = _session_arg(p.args)
        if not s:
            continue
        path = s if os.path.isabs(s) else os.path.join(cwd, s)
        hits = [path] if os.path.isfile(path) else glob.glob(os.path.join(root, "*", f"*_{glob.escape(s)}*.jsonl"))
        if hits:
            return _found(hits[0], cwd, "exact", "started with --session")
    folder = "--" + re.sub(r"[/\\:]", "-", re.sub(r"^[/\\]", "", cwd)) + "--"  # pi's own naming (session-manager.js)
    files = glob.glob(os.path.join(root, glob.escape(folder), "*.jsonl"))
    if not files:
        return {"error": {"code": "not-found", "message": f"no pi session in {cwd}"}}
    return _found(max(files, key=os.path.getmtime), cwd, "guess", "newest in folder")


def copy(req: dict, env) -> dict:
    return pi_format.copy(req, env, "pi", ["--tools", "read,grep,find,ls"])
