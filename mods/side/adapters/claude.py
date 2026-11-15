"""Claude Code: a running claude writes ~/.claude/sessions/<pid>.json (sessionId, cwd); Herdr's foreground pid may
be a shell above it, so the process tree is walked. A copy is `--resume <id> --fork-session` (new id, original
untouched); answer-only is plan mode plus a one-line instruction (about 1% extra cache write, findings §6)."""
import json
import os

NAME = "Claude Code"
INSTR = "Answer and explain; don't edit files. Files may have changed since this point."
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


def copy(req: dict, env) -> dict:
    p, _ = _owner(req, env)
    args = p.args if p and p.args else ["claude"]
    # ps splits a path with spaces (the desktop app's "…/Application Support/…"): then run claude from PATH
    prog = args[0] if "/" not in args[0] or os.path.exists(args[0]) else "claude"
    sid = req["session"]["id"]
    argv = [prog, "--resume", sid, "--fork-session", *_carried(args)]
    if req.get("answerOnly"):
        argv += ["--permission-mode", "plan", "--append-system-prompt", INSTR]
    return {"launch": {"argv": argv, "cwd": req["session"]["cwd"]}, "note": None}
