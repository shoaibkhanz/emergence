"""Claude Code: a running claude writes ~/.claude/sessions/<pid>.json (sessionId, cwd); Herdr's foreground pid may
be a shell above it, so the process tree is walked. A side chat is a fresh session (empty screen, original untouched)
given the conversation as background: `--append-system-prompt-file` with the side-chat instruction, the latest
compaction summary and the most recent exchanges, plus the path of a plain-text digest of the whole conversation it
can read when asked about something older. Files, never argv: argv shows in `ps`. Answer-only adds plan mode."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import glob
import json
import os
import shutil
import time

NAME = "Claude Code"
INSTR = "Answer and explain; don't edit files. Files may have changed since this point."
CAP = 24000  # characters of recent exchanges in the background (~6k tokens)
KEEP = 20  # chat folders kept under <dataDir>/chats
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


def _carried(args: list[str]) -> list[str]:
    out, i = [], 1
    while i < len(args):
        a = args[i]
        if a in CARRY and i + 1 < len(args):
            out += [a, args[i + 1]]
            i += 2
            continue
        if a.split("=", 1)[0] in CARRY and "=" in a:
            out.append(a)
        i += 1
    return out


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


def digest(es: list) -> str:
    """Entries as text: a heading each time the speaker changes."""
    out, last = [], None
    for role, text in es:
        if role != last:
            out.append(f"\n## {'You' if role == 'user' else 'Agent'}\n")
            last = role
        out.append(text)
    return "\n".join(out).strip() + "\n"


def recent(es: list, cap: int = CAP) -> list:
    """The longest tail of entries that starts at something the person said and fits in cap characters. If none
    does (pressed mid-work, or one huge exchange), the longest tail that fits, topped up with the end of the entry
    before it, so the background is never just "[used Bash]"."""
    best, size, j = None, 0, len(es)
    for i in range(len(es) - 1, -1, -1):
        if size + len(es[i][1]) > cap:
            break
        size += len(es[i][1])
        j = i
        if es[i][0] == "user":
            best = i
    if best is not None:
        return es[best:]
    rest = cap - size
    head = [(es[j - 1][0], es[j - 1][1][-rest:])] if j > 0 and rest > 0 else []
    return head + es[j:]


def _write(path: str, text: str) -> None:
    """A private file (0600): the conversation is as private as Claude's own transcripts."""
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
        f.write(text)


def _write_chat(sid: str, transcript: str, data_dir: str) -> str:
    with open(transcript, encoding="utf-8") as f:
        es, summary = entries(f)
    chats = os.path.join(data_dir, "chats")
    d = os.path.join(chats, f"{int(time.time() * 1000)}-{sid[:8]}")
    os.makedirs(d, mode=0o700)
    conv = os.path.join(d, "conversation.md")
    _write(conv, digest(es))
    bg = [INSTR, f"You're a side chat beside an agent. Its whole conversation so far is in {conv}; read it in parts "
                 "when asked about something not below.",
          f"## Earlier, summarised\n\n{summary}" if summary else "",
          "## Most recent exchanges\n" + digest(recent(es))]
    path = os.path.join(d, "background.md")
    _write(path, "\n\n".join(b for b in bg if b))
    for old in sorted(os.listdir(chats))[:-KEEP]:
        shutil.rmtree(os.path.join(chats, old), ignore_errors=True)
    return path


def copy(req: dict, env) -> dict:
    p, _ = _owner(req, env)
    args = p.args if p and p.args else ["claude"]
    # ps splits a path with spaces (the desktop app's "…/Application Support/…"): then run claude from PATH
    prog = args[0] if "/" not in args[0] or os.path.exists(args[0]) else "claude"
    sid = req["session"]["id"]
    found = glob.glob(os.path.join(env.home, ".claude", "projects", "*", f"{sid}.jsonl"))
    if not found:
        return {"error": {"code": "not-found", "message": "this Claude session has no conversation yet"}}
    bg = _write_chat(sid, found[0], req["dataDir"])
    mode = ["--permission-mode", "plan"] if req.get("answerOnly") else []
    argv = [prog, *mode, "--append-system-prompt-file", bg, *_carried(args)]
    return {"launch": {"argv": argv, "cwd": req["session"]["cwd"]}, "note": None if req.get("answerOnly") else "can-edit"}
