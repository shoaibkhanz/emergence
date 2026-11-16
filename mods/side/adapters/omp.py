"""omp: a running omp writes ~/.omp/agent/terminal-sessions/<tty> (its folder, then its session file), so the pane's
tty names the session exactly. A side chat is a fresh omp given the conversation as background (pi_format): never the
session file itself, which omp writes into on quit. Answer-only allows only omp's read and search tools."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import os

from . import pi_format

NAME = "omp"


def caps() -> dict:
    return {"locate": "exact", "full": True, "before": None, "answerOnly": "enforced"}


def locate(req: dict, env) -> dict:
    for p in env.procs(int(req["pid"])):
        ptr = os.path.join(env.home, ".omp", "agent", "terminal-sessions", p.tty or "")
        if not p.tty or not os.path.isfile(ptr):
            continue
        with open(ptr, encoding="utf-8") as f:
            lines = f.read().splitlines()
        if len(lines) > 1 and os.path.isfile(lines[1]):
            return {"session": {"harness": "omp", "id": pi_format.session_id(lines[1]), "file": lines[1],
                                "cwd": req.get("cwd") or lines[0]},
                    "confidence": "exact", "why": f"~/.omp/agent/terminal-sessions/{p.tty}"}
    return {"error": {"code": "not-found", "message": "no ~/.omp/agent/terminal-sessions/<tty> for this pane"}}


def copy(req: dict, env) -> dict:
    return pi_format.copy(req, env, "omp", "read,grep,glob,find")
