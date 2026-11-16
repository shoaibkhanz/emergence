"""pi's session format, which omp shares: one JSONL file, a tree of entries (id, parentId) whose last entry is where
the conversation is now; going back (/tree, /branch) leaves the abandoned turns in the file. A side chat starts a
fresh session given the conversation as background (chat.py), so the original file is only read: never opened by the
harness, which would write into it (omp's session_exit, pi's extensions)."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import json
import os

from .chat import carried, write_chat

CARRY = ("--model", "--provider", "--thinking", "--profile")  # the same model, and omp's profile (its auth and store)


def entries(lines) -> tuple:
    """Session lines -> ([(role, text)] along the current branch, its latest compaction summary or None). Only what
    was said: no tool results, thinking, images or injected messages; a tool use is one "[used <name>]" line."""
    by_id, last = {}, None
    for line in lines:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if isinstance(o, dict) and o.get("id") and o.get("type") != "session":
            by_id[o["id"]] = o
            last = o["id"]
    path, seen = [], set()
    while last in by_id and last not in seen:
        seen.add(last)
        path.append(by_id[last])
        last = by_id[last].get("parentId")
    out, summary = [], None
    for o in reversed(path):
        if o.get("type") == "compaction":
            summary = o.get("summary") or summary
            continue
        m = o.get("message") if o.get("type") == "message" else None
        role = (m or {}).get("role")
        if role not in ("user", "assistant"):
            continue
        c = m.get("content")
        for p in [{"type": "text", "text": c}] if isinstance(c, str) else c if isinstance(c, list) else []:
            if not isinstance(p, dict):
                continue
            if p.get("type") == "text" and (p.get("text") or "").strip():
                out.append(("user" if role == "user" else "agent", p["text"]))
            elif role == "assistant" and p.get("type") == "toolCall":
                out.append(("agent", f"[used {p.get('name')}]"))
    return out, summary


def session_id(file: str) -> str:
    """<ISO time>_<id>.jsonl -> id."""
    return os.path.basename(file)[:-6].split("_", 1)[-1]


def copy(req: dict, env, prog: str, read_only: str) -> dict:
    """A fresh `prog` session beside the agent with its conversation as background; answer-only allows only the
    read_only tools. The agent's model flags are carried from its process (the one running `prog`)."""
    s = req["session"]
    try:
        with open(s["file"], encoding="utf-8") as f:
            es, summary = entries(f)
    except OSError:
        es, summary = [], None
    if not es:
        return {"error": {"code": "not-found", "message": f"this {prog} session has no conversation yet"}}
    bg = write_chat(s["id"], es, summary, req["dataDir"])
    owner = next((p for p in env.procs(int(req["pid"])) if prog in map(os.path.basename, p.args[:2])), None)
    tools = ["--tools", read_only] if req.get("answerOnly") else []
    argv = [prog, "--append-system-prompt", bg, *tools, *carried(owner.args if owner else [], CARRY)]
    return {"launch": {"argv": argv, "cwd": s["cwd"]}, "note": None if req.get("answerOnly") else "can-edit"}
