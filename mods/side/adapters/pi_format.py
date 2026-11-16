"""pi's session format, which omp shares: one JSONL file, a tree of entries (id, parentId) whose last entry is where
the conversation is now; going back (/tree, /branch) leaves the abandoned turns in the file. A side chat starts a
fresh session given the conversation as background (chat.py), so the original file is only read: never opened by the
harness, which would write into it (omp's session_exit, pi's extensions)."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import json
import os

from .chat import carried, write_chat

CARRY = ("--profile",)  # omp's profile (its auth and store); the model comes from the session (model_flags)


def _branch(lines) -> list:
    """Session lines -> the current branch's entries, oldest first."""
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
    return path[::-1]


def model_flags(lines) -> list[str]:
    """The model and thinking level the current branch last set, as flags: the copy talks to the same model. From the
    session, not argv: a running pi shows only "pi" in ps (process.title). pi records provider and modelId, omp
    "provider/id"."""
    model = thinking = None
    for o in _branch(lines):
        if o.get("type") == "model_change":
            m = o.get("model") or "/".join(x for x in (o.get("provider"), o.get("modelId")) if x)
            model = m or model
        elif o.get("type") == "thinking_level_change":
            thinking = o.get("thinkingLevel") or thinking
    return (["--model", model] if model else []) + (["--thinking", thinking] if thinking else [])


def entries(lines) -> tuple:
    """Session lines -> ([(role, text)] along the current branch, its latest compaction summary or None). Only what
    was said: no tool results, thinking, images or injected messages; a tool use is one "[used <name>]" line."""
    out, summary = [], None
    for o in _branch(lines):
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


def copy(req: dict, env, prog: str, read_only: list[str]) -> dict:
    """A fresh `prog` session beside the agent with its conversation as background; answer-only adds the read_only
    flags. --no-session: the side chat saves nothing, so it's never mistaken for the agent's session, and omp's
    autoResume can't open the agent's file. The model and thinking level come from the session (model_flags), omp's
    --profile from the agent's process (the one running `prog`)."""
    s = req["session"]
    try:
        with open(s["file"], encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        lines = []
    es, summary = entries(lines)
    if not es:
        return {"error": {"code": "not-found", "message": f"this {prog} session has no conversation yet"}}
    bg = write_chat(s["id"], es, summary, req["dataDir"])
    owner = next((p for p in env.procs(int(req["pid"])) if prog in map(os.path.basename, p.args[:2])), None)
    tools = read_only if req.get("answerOnly") else []
    argv = [prog, "--no-session", "--append-system-prompt", bg, *tools, *model_flags(lines),
            *carried(owner.args if owner else [], CARRY)]
    return {"launch": {"argv": argv, "cwd": s["cwd"]}, "note": None if req.get("answerOnly") else "can-edit"}
