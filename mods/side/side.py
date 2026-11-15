"""Side sessions' helper: which session an agent pane runs, and what to run to open a copy of it.

One call per invocation, JSON in and out, no state: `python3 side.py <op> --json '<request>'` prints one object with
"v": 1, or {"v": 1, "error": {code, message}}; it always exits 0 so the mod reads one shape. Per-harness knowledge
lives only in adapters/<harness>.py; see docs/superpowers/specs/2026-11-15-side-sessions-design.md (local).
"""
import json
import os
import subprocess
import sys
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

V = 1


@dataclass(frozen=True)
class Proc:
    pid: int
    args: list[str] = field(default_factory=list)
    tty: str | None = None


@dataclass(frozen=True)
class Env:
    home: str
    run: Callable[[list[str]], tuple[int, str]]  # argv -> (exit code, stdout; stderr's last line on failure)
    procs: Callable[[int], list[Proc]]  # pid -> that pid, then its descendants, breadth-first


def procs_from(ps: str, pid: int) -> list[Proc]:
    """`ps -axo pid=,ppid=,tty=,args=` text -> pid and its descendants, breadth-first."""
    rows, kids = {}, {}
    for line in ps.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 3 or not parts[0].isdigit():
            continue
        p, pp, tty = int(parts[0]), int(parts[1]), parts[2]
        rows[p] = Proc(p, parts[3].split() if len(parts) > 3 else [], None if tty in ("??", "-") else tty)
        kids.setdefault(pp, []).append(p)
    out, todo = [], deque([pid])
    while todo:
        p = todo.popleft()
        if p in rows:
            out.append(rows[p])
        todo.extend(kids.get(p, []))
    return out


def run(argv: list[str]) -> tuple[int, str]:
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, str(e)
    return r.returncode, r.stdout if r.returncode == 0 else ((r.stderr or r.stdout).strip().splitlines() or [""])[-1]


def real_env() -> Env:
    return Env(home=os.path.expanduser("~"), run=run,
               procs=lambda pid: procs_from(run(["ps", "-axo", "pid=,ppid=,tty=,args="])[1], pid))


def error(code: str, message: str) -> dict:
    return {"v": V, "error": {"code": code, "message": message}}


def handle(op: str, req: dict, env: Env) -> dict:
    from adapters import ADAPTERS
    if op not in ("caps", "locate", "copy"):
        return error("unknown-op", f"unknown op {op!r}")
    adapter = ADAPTERS.get(req.get("harness") or (req.get("session") or {}).get("harness"))
    if adapter is None:
        return error("unknown-harness", f"no adapter for {req.get('harness')!r}")
    try:
        answer = adapter.caps() if op == "caps" else getattr(adapter, op)(req, env)
    except Exception as e:  # an adapter's bug is one error answer, never a traceback the mod can't read
        return error("internal", f"{type(e).__name__}: {e}")
    return {"v": V, **answer}


def main(argv: list[str]) -> None:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    op = argv[1] if len(argv) > 1 else ""
    try:
        req = json.loads(argv[argv.index("--json") + 1]) if "--json" in argv else {}
    except (ValueError, IndexError) as e:
        print(json.dumps(error("bad-request", str(e))))
        return
    print(json.dumps(handle(op, req, real_env())))


if __name__ == "__main__":
    main(sys.argv)
