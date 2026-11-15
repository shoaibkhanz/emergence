"""OpenCode: sessions live in its SQLite database behind the background service, reached with `opencode api`. The
running process names its session only when started with -s; otherwise the folder's newest session is a guess. A
copy is the API's session.fork (a full copy needs the empty body). Answer-only opens it with OpenCode's read-only plan
agent, which only `opencode mini --agent` can choose (the main TUI has no --agent, and session.update ignores the
agent); otherwise `opencode -s <new>`, which can edit files (findings §2)."""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import json

NAME = "OpenCode"


def caps() -> dict:
    return {"locate": "guess", "full": True, "before": None, "answerOnly": "enforced"}


def _session_arg(args: list[str]) -> str | None:
    for i, a in enumerate(args):
        if a in ("-s", "--session") and i + 1 < len(args):
            return args[i + 1]
        if a.startswith("--session="):
            return a.split("=", 1)[1]
    return None


def locate(req: dict, env) -> dict:
    cwd = req.get("cwd")
    for p in env.procs(int(req["pid"])):
        sid = _session_arg(p.args)
        if sid:
            return {"session": {"harness": "opencode", "id": sid, "cwd": cwd}, "confidence": "exact",
                    "why": "started with -s"}
    code, out = env.run(["opencode", "api", "session.list", "--param", f"directory={cwd}"])
    if code != 0:
        return {"error": {"code": "locate-failed", "message": out}}
    rows = json.loads(out).get("data") or []
    if not rows:
        return {"error": {"code": "not-found", "message": f"no OpenCode session in {cwd}"}}
    # A copy (its "fork" set, which every side chat makes) is newest right after it's made: prefer an original.
    pool = [r for r in rows if not r.get("fork")] or rows
    newest = max(pool, key=lambda r: (r.get("time") or {}).get("updated") or 0)
    return {"session": {"harness": "opencode", "id": newest["id"], "cwd": cwd}, "confidence": "guess",
            "why": "newest in folder"}


def copy(req: dict, env) -> dict:
    s = req["session"]
    code, out = env.run(["opencode", "api", "session.fork", "--param", f"sessionID={s['id']}", "-d", "{}"])
    if code != 0:
        return {"error": {"code": "copy-failed", "message": out}}
    new = json.loads(out)["data"]["id"]
    if req.get("answerOnly"):
        return {"launch": {"argv": ["opencode", "mini", "--agent", "plan", "-s", new], "cwd": s["cwd"]}, "note": None}
    return {"launch": {"argv": ["opencode", "-s", new], "cwd": s["cwd"]}, "note": "can-edit"}
