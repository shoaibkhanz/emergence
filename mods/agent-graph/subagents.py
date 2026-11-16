"""What the agents' in-process sub-agents are doing: Claude Code's Task/Agent sub-agents and omp's task ones, which
Herdr knows nothing about (it sees only terminals). pi, Codex and OpenCode: not read in v1.

`python3 subagents.py --json '[{address, pid, harness, top}]'` (the live local agent terminals: foreground pid, "claude"
or "omp", the git top of their folder) prints {"v": 1, "agents": {address: {edited, subagents}}}, or {"v": 1, "error":
{code, message}}; it always exits 0. edited: [{path, rel, at, dirty}], newest first (rel: worktree-relative, dirty:
still uncommitted). A sub-agent: {id, title, running, action, edited, worktree, updatedAt}; running ones and those
updated in the last 30 min. Only file paths and short labels (a Bash call's description, omp's intent) come out, never
commands, prompts or output. Logs are read from a byte offset kept per file in <app>/data/agent-graph/subagents.json.
"""
from __future__ import annotations  # stock macOS python3 is 3.9: `str | None` must not evaluate at import

import glob
import json
import os
import re
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

V = 1
MIN = 60_000
RECENT = 30 * MIN  # finished sub-agents (and the agent's own edits) shown this long
STALE = 10 * MIN  # a sub-agent silent this long isn't running, finished or not
TAIL = 8 << 20  # an agent's own transcript is first read from this far before its end: only recent edits matter
PENDING = 20  # calls in flight remembered per log (an interrupted one never gets its result)
CLAUDE_EDITS = ("Edit", "MultiEdit", "Write", "NotebookEdit")


@dataclass(frozen=True)
class Proc:
    pid: int
    tty: str | None = None


@dataclass(frozen=True)
class Env:
    home: str
    app: str  # Herdr's app home
    now: int  # ms
    procs: Callable[[int], list]  # pid -> that pid, then its descendants, breadth-first
    git_status: Callable[[str], "str | None"]  # worktree top -> `git status --porcelain -z` stdout, None on failure


def procs_from(ps: str, pid: int) -> list:
    """`ps -axo pid=,ppid=,tty=` text -> pid and its descendants, breadth-first (as mods/side/side.py)."""
    rows, kids = {}, {}
    for line in ps.splitlines():
        parts = line.split()
        if len(parts) < 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        p = int(parts[0])
        rows[p] = Proc(p, None if parts[2] in ("??", "-") else parts[2])
        kids.setdefault(int(parts[1]), []).append(p)
    out, todo = [], deque([pid])
    while todo:
        p = todo.popleft()
        if p in rows:
            out.append(rows[p])
        todo.extend(kids.get(p, []))
    return out


def ms(v, default: int) -> int:
    """A log timestamp (ISO text, or epoch s / ms) -> epoch ms."""
    if isinstance(v, (int, float)) and v > 0:
        return int(v if v > 1e12 else v * 1000)
    if isinstance(v, str):
        try:
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            pass
    return default


def first_line(s, n: int = 80) -> str:
    return (s or "").strip().split("\n")[0][:n] if isinstance(s, str) else ""


def claude_label(name: str, inp: dict) -> str:
    """What a Claude tool call is doing, for people: a Bash call's own description, else the tool and file."""
    base = os.path.basename(str(inp.get("file_path") or inp.get("notebook_path") or ""))
    if name == "Bash":
        return first_line(inp.get("description")) or "Running a command"
    if name in ("Edit", "MultiEdit", "NotebookEdit", "Write", "Read") and base:
        return f"{'Write' if name == 'Write' else 'Read' if name == 'Read' else 'Edit'} {base}"
    if name in ("Grep", "Glob"):
        return "Search"
    if name in ("Task", "Agent"):
        return "Starting a sub-agent"
    if name.startswith("Web"):
        return "Reading the web"
    return name.split("__")[-1]


EDIT_HEAD = re.compile(r"^\[(.+?)#\w+\]")  # omp's edit input starts with [<path>#<hash>]


def omp_path(name: str, args: dict) -> str | None:
    if name == "edit":
        m = EDIT_HEAD.match(args.get("input") or "") if isinstance(args.get("input"), str) else None
        return m.group(1) if m else args.get("path")
    return args.get("path") if isinstance(args.get("path"), str) else None


def omp_label(name: str, args: dict, intent) -> str:
    """omp's own one-line intent for a call, else the tool and file."""
    if first_line(intent):
        return first_line(intent)
    if name == "bash":
        return "Running a command"
    p = omp_path(name, args)
    return f"{name.capitalize()} {os.path.basename(p)}" if p else name.capitalize()


def _abs(p, cwd) -> str | None:
    if not isinstance(p, str) or not p:
        return None
    return p if os.path.isabs(p) or not cwd else os.path.normpath(os.path.join(cwd, p))


def _parts(o: dict) -> list:
    c = (o.get("message") or {}).get("content") if isinstance(o.get("message"), dict) else None
    return [p for p in c if isinstance(p, dict)] if isinstance(c, list) else []


def _pend(st: dict, cid, label: str) -> None:
    if cid:
        st["pending"][cid] = label
        while len(st["pending"]) > PENDING:
            st["pending"].pop(next(iter(st["pending"])))


def parse_claude(o: dict, st: dict, at: int) -> None:
    """One Claude transcript line into the log's state: edits (Edit/Write paths and the files a Bash command changed)
    and calls still waiting for their result."""
    kind = o.get("type")
    if kind not in ("assistant", "user"):
        return
    cwd = o.get("cwd") or st.get("cwd")
    st["cwd"] = cwd
    for p in _parts(o):
        if kind == "assistant" and p.get("type") == "tool_use":
            name, inp = str(p.get("name") or ""), p.get("input") if isinstance(p.get("input"), dict) else {}
            if name in CLAUDE_EDITS:
                path = _abs(inp.get("file_path") or inp.get("notebook_path"), cwd)
                if path:
                    st["edits"][path] = at
            _pend(st, p.get("id"), claude_label(name, inp))
        elif kind == "user" and p.get("type") == "tool_result":
            st["pending"].pop(p.get("tool_use_id"), None)
    diff = o.get("toolUseResult", {}).get("bashEditDiff") if isinstance(o.get("toolUseResult"), dict) else None
    if isinstance(diff, dict):
        files = [f.get("filePath") for f in diff.get("files") or [] if isinstance(f, dict)]
        for f in files + list(diff.get("changedFiles") or []):
            path = _abs(f, cwd)
            if path:
                st["edits"][path] = at


def parse_omp(o: dict, st: dict, at: int) -> None:
    """One omp (pi format) line: written and edited paths, calls in flight with their intent, and session_exit."""
    kind = o.get("type")
    if kind == "session":
        st["cwd"] = o.get("cwd") or st.get("cwd")
    elif kind == "custom":
        d = o.get("data") if isinstance(o.get("data"), dict) else {}
        if o.get("customType") == "tool_execution_start":
            args = d.get("args") if isinstance(d.get("args"), dict) else {}
            _pend(st, d.get("toolCallId"), omp_label(str(d.get("toolName") or ""), args, d.get("intent") or args.get("i")))
        elif o.get("customType") == "session_exit":
            st["done"] = True
    elif kind == "message":
        m = o["message"] if isinstance(o.get("message"), dict) else {}
        if m.get("role") == "assistant":
            for p in _parts(o):
                if p.get("type") != "toolCall":
                    continue
                name, args = str(p.get("name") or ""), p.get("arguments") if isinstance(p.get("arguments"), dict) else {}
                if name in ("edit", "write"):
                    path = _abs(omp_path(name, args), st.get("cwd"))
                    if path:
                        st["edits"][path] = at
                _pend(st, p.get("id"), omp_label(name, args, p.get("intent") or args.get("i")))
        elif m.get("role") == "toolResult":
            st["pending"].pop(m.get("toolCallId"), None)
            d = m.get("details") if isinstance(m.get("details"), dict) else {}
            path = _abs(d.get("path"), st.get("cwd")) if m.get("toolName") in ("edit", "write") else None
            if path:
                st["edits"][path] = at


def read(path: str, cache: dict, parse, mtime: int, tail: bool = False) -> dict:
    """The log's state, after parsing only what was appended since the last run (complete lines only). A log that
    shrank is read again; a first read of an agent's own transcript (tail) starts near its end."""
    e = cache.get(path)
    size = os.path.getsize(path)
    fresh = not e or e.get("off", 0) > size
    if fresh:
        e = {"off": max(0, size - TAIL) if tail else 0, "st": {"edits": {}, "pending": {}, "done": False, "cwd": None}}
    with open(path, "rb") as f:
        f.seek(e["off"])
        chunk = f.read()
    end = chunk.rfind(b"\n") + 1
    lines = chunk[:end].split(b"\n")
    if fresh and e["off"]:
        lines = lines[1:]  # started mid-line
    for line in lines:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if isinstance(o, dict):
            parse(o, e["st"], ms(o.get("timestamp"), mtime))
    e = {"off": e["off"] + end, "st": e["st"]}
    cache[path] = e
    return e["st"]


def porcelain(out: str) -> list:
    """`git status --porcelain -z` -> the paths it lists (a rename's new path)."""
    fields, paths, i = out.split("\0"), [], 0
    while i < len(fields):
        f = fields[i]
        if len(f) > 3:
            paths.append(f[3:])
            if f[0] in "RC":
                i += 1  # the old path follows
        i += 1
    return paths


class Dirty:
    """Which files are still uncommitted, per worktree (git asked once per run per worktree)."""

    def __init__(self, env: Env):
        self.env, self.seen = env, {}

    def of(self, top: str | None) -> set:
        if not top:
            return set()
        if top not in self.seen:
            out = self.env.git_status(top)
            real = os.path.realpath(top)
            self.seen[top] = {os.path.join(real, p) for p in porcelain(out)} if out else set()
        return self.seen[top]


def edited(st: dict, top: str | None, dirty: Dirty, since: int = 0) -> list:
    real = os.path.realpath(top) + os.sep if top else None
    out = []
    for path, at in sorted(st["edits"].items(), key=lambda kv: -kv[1]):
        if at < since:
            continue
        rp = os.path.realpath(path)
        out.append({"path": path, "rel": rp[len(real):] if real and rp.startswith(real) else None, "at": at,
                    "dirty": rp in dirty.of(top)})
    return out


def subagent(sid, title, path, st, running, worktree, top, mtime, dirty) -> dict:
    pending = list(st["pending"].values())
    return {"id": sid, "title": title, "running": running, "action": pending[-1] if running and pending else None,
            "edited": edited(st, worktree or top, dirty), "worktree": worktree, "updatedAt": mtime}


def load(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def mtime_ms(p: str) -> int:
    return int(os.path.getmtime(p) * 1000)


def claude(a: dict, env: Env, cache: dict, dirty: Dirty) -> dict:
    """A Claude Code agent: its pid's tree -> ~/.claude/sessions/<pid>.json -> sessionId -> the transcript beside
    ~/.claude/projects/*/<sessionId>/subagents/agent-<id>.jsonl (+ .meta.json)."""
    sid = None
    for p in env.procs(int(a["pid"])):
        f = os.path.join(env.home, ".claude", "sessions", f"{p.pid}.json")
        if os.path.isfile(f):
            sid = (load(f) or {}).get("sessionId")
            break
    out = {"edited": [], "subagents": []}
    if not sid:
        return out
    top = a.get("top")
    for log in glob.glob(os.path.join(env.home, ".claude", "projects", "*", f"{sid}.jsonl"))[:1]:
        out["edited"] = edited(read(log, cache, parse_claude, mtime_ms(log), tail=True), top, dirty, env.now - RECENT)
    for log in glob.glob(os.path.join(env.home, ".claude", "projects", "*", sid, "subagents", "agent-*.jsonl")):
        try:
            meta_f = log[:-6] + ".meta.json"
            meta = load(meta_f) if os.path.isfile(meta_f) else {}
            meta = meta if isinstance(meta, dict) else {}
            mt = mtime_ms(log)
            running = not meta.get("finished") and env.now - mt < STALE
            if not running and env.now - mt > RECENT:
                continue
            st = read(log, cache, parse_claude, mt)
            title = first_line(meta.get("description")) or first_line(meta.get("agentType")) or "Sub-agent"
            wt = meta.get("worktreePath") if isinstance(meta.get("worktreePath"), str) else None
            out["subagents"].append(subagent(os.path.basename(log)[6:-6], title, log, st, running, wt, top, mt, dirty))
        except (OSError, ValueError, AttributeError, TypeError) as ex:
            print(f"subagents: {log}: {type(ex).__name__}: {ex}", file=sys.stderr)
    return out


def omp(a: dict, env: Env, cache: dict, dirty: Dirty) -> dict:
    """An omp agent: its tty -> ~/.omp/agent/terminal-sessions/<tty> (line 2: the session file) -> task sub-agents
    as <session without .jsonl>/<Task>.jsonl, nested ones a level down (<Task>/<Task.Sub>.jsonl); __* are omp's own."""
    session = None
    for p in env.procs(int(a["pid"])):
        ptr = os.path.join(env.home, ".omp", "agent", "terminal-sessions", p.tty or "")
        if p.tty and os.path.isfile(ptr):
            with open(ptr, encoding="utf-8") as f:
                lines = f.read().splitlines()
            if len(lines) > 1 and lines[1].endswith(".jsonl") and os.path.isfile(lines[1]):
                session = lines[1]
                break
    out = {"edited": [], "subagents": []}
    if not session:
        return out
    top = a.get("top")
    out["edited"] = edited(read(session, cache, parse_omp, mtime_ms(session), tail=True), top, dirty, env.now - RECENT)
    root = session[:-6]
    for d, _, files in os.walk(root):
        for name in files:
            if not name.endswith(".jsonl") or name.startswith("__"):
                continue
            log = os.path.join(d, name)
            try:
                mt = mtime_ms(log)
                if env.now - mt > RECENT:
                    continue
                st = read(log, cache, parse_omp, mt)
                running = not st.get("done") and env.now - mt < STALE
                rel = os.path.relpath(log, root)[:-6]
                out["subagents"].append(subagent(rel, name[:-6], log, st, running, None, top, mt, dirty))
            except (OSError, ValueError) as ex:
                print(f"subagents: {log}: {type(ex).__name__}: {ex}", file=sys.stderr)
    return out


HARNESSES = {"claude": claude, "omp": omp}


def error(code: str, message: str) -> dict:
    return {"v": V, "error": {"code": code, "message": message}}


def scan(req, env: Env) -> dict:
    if not isinstance(req, list):
        return error("bad-request", "expected a list of agents")
    cache_f = os.path.join(env.app, "data", "agent-graph", "subagents.json")
    try:
        old = load(cache_f)
        old = old if isinstance(old, dict) else {}
    except (OSError, ValueError):
        old = {}
    cache, dirty, agents = dict(old), Dirty(env), {}
    for a in req:
        fn = HARNESSES.get(a.get("harness")) if isinstance(a, dict) else None
        if not fn or not a.get("address"):
            continue
        try:
            agents[a["address"]] = fn(a, env, cache, dirty)
        except Exception as ex:  # one agent's bad file is that agent's error, never the panel's
            agents[a["address"]] = {"error": f"{type(ex).__name__}: {ex}"}
    kept = {k: v for k, v in cache.items() if k not in old or v is not old[k]}  # logs this run read; the rest are gone
    try:
        os.makedirs(os.path.dirname(cache_f), exist_ok=True)
        tmp = f"{cache_f}.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(kept, f)
        os.replace(tmp, cache_f)  # two copies (panel, popup) may run at once
    except OSError as ex:
        print(f"subagents: cache: {ex}", file=sys.stderr)
    return {"v": V, "agents": agents}


def run(argv: list) -> tuple:
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=10)
        return r.returncode, r.stdout
    except (OSError, subprocess.TimeoutExpired):
        return 127, ""


def real_env() -> Env:
    home = os.path.expanduser("~")
    ps = []  # one ps per run, only once an agent asks

    def procs(pid: int) -> list:
        if not ps:
            ps.append(run(["ps", "-axo", "pid=,ppid=,tty="])[1])
        return procs_from(ps[0], pid)

    def git_status(top: str):
        # no index.lock: the agents in that worktree may be committing right now
        code, out = run(["git", "--no-optional-locks", "-C", top, "status", "--porcelain", "-z", "--untracked-files=all"])
        return out if code == 0 else None

    return Env(home=home, app=os.environ.get("HERDR_APP_HOME") or os.path.join(home, ".config", "herdr-app"),
               now=int(time.time() * 1000), procs=procs, git_status=git_status)


def main(argv: list) -> None:
    try:
        req = json.loads(argv[argv.index("--json") + 1]) if "--json" in argv else []
    except (ValueError, IndexError) as e:
        print(json.dumps(error("bad-request", str(e))))
        return
    try:
        print(json.dumps(scan(req, real_env())))
    except Exception as e:  # always one JSON answer
        print(json.dumps(error("internal", f"{type(e).__name__}: {e}")))


if __name__ == "__main__":
    main(sys.argv)
