"""What the agents' in-process sub-agents are doing: Claude Code's Task/Agent sub-agents and omp's task ones, which
Herdr knows nothing about (it sees only terminals). pi, Codex and OpenCode: not read in v1.

`python3 subagents.py --json '[{address, pid, harness, top}]'` (the live local agent terminals: foreground pid, "claude"
or "omp", the git top of their folder) prints {"v": 1, "agents": {address: {edited, subagents, ...metrics}}}, or
{"v": 1, "error": {code, message}}; it always exits 0. edited: [{path, rel, at, dirty}], newest first (rel:
worktree-relative, dirty: still uncommitted). A sub-agent: {id, title, running, action, edited, worktree, updatedAt,
finishedAt, ...metrics}: every one the session ran. Metrics, the agent's own and each sub-agent's: {tools, tokens,
cost, costKind}: tool calls, tokens (input, output, cache reads and writes), USD; costKind "recorded" (omp's own
figure), "api" (Claude billed to an API key), "estimate" (Claude on a subscription: tokens at API prices), null with
no price. Only file paths, short labels (a Bash call's description, omp's intent) and numbers come out, never commands,
prompts, output or keys. Logs are read from a byte offset kept per file in <app>/data/agent-graph/subagents-2.json.
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
from functools import partial
from typing import Callable

V = 1
MIN = 60_000
RECENT = 30 * MIN  # the agent's own edits shown this long
STALE = 10 * MIN  # a sub-agent silent this long isn't running, finished or not
TAIL = 8 << 20  # before this far from its end, an agent's own transcript's first read takes only usage lines
PENDING = 20  # calls in flight remembered per log (an interrupted one never gets its result)
CLAUDE_EDITS = ("Edit", "MultiEdit", "Write", "NotebookEdit")
CACHE = "subagents-2.json"  # -2: entries carry metrics; the first version's had none

# Claude API list prices, $ per million tokens: (input, output, cache-read multiplier of input). Cache writes are
# input x1.25 (5 min) or x2 (1 h); "fast" speed doubles everything. From the Claude API reference, 2026-11-03. This is
# what Claude Code itself computes (its cost-state totalCostUSD), even on a subscription. Bedrock, Vertex and
# negotiated prices differ. A model not listed gets no price, never a guess.
PRICES = {
    "claude-fable-5-2": (8, 40, 0.025), "claude-fable-5-1": (10, 50, 0.025), "claude-fable-5": (10, 50, 0.1),
    "claude-mythos-5-2": (8, 40, 0.025), "claude-mythos-5-1": (10, 50, 0.025),
    "claude-opus-5-5": (4, 20, 0.05), "claude-opus-5": (5, 25, 0.1),
    "claude-opus-4-8": (5, 25, 0.1), "claude-opus-4-7": (5, 25, 0.1), "claude-opus-4-6": (5, 25, 0.1),
    "claude-sonnet-5-5": (2, 10, 0.05), "claude-sonnet-5": (2, 10, 0.1), "claude-sonnet-4-6": (3, 15, 0.1),
    "claude-haiku-5-5": (0.10, 0.50, 0.1), "claude-haiku-4-5": (1, 5, 0.1),
}


def price(model) -> tuple | None:
    """The longest listed prefix that ends at a boundary: "claude-fable-5-20261101" is fable-5 dated, not fable-5-2."""
    if not isinstance(model, str):
        return None
    hits = [k for k in PRICES if model == k or (model.startswith(k) and model[len(k)] in "-@[")]
    return PRICES[max(hits, key=len)] if hits else None


def claude_cost(model, u: dict) -> float | None:
    """One assistant message's USD at list prices, from its usage."""
    p = price(model)
    if not p:
        return None
    n = lambda k, d=u: d.get(k) if isinstance(d.get(k), (int, float)) else 0
    i, o, read = p
    cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else None
    write = n("ephemeral_5m_input_tokens", cc) * 1.25 + n("ephemeral_1h_input_tokens", cc) * 2 if cc \
        else n("cache_creation_input_tokens") * 1.25
    usd = (n("input_tokens") * i + n("output_tokens") * o + write * i + n("cache_read_input_tokens") * i * read) / 1e6
    return usd * 2 if u.get("speed") == "fast" else usd


def claude_tokens(u: dict) -> int:
    return sum(u.get(k) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
               if isinstance(u.get(k), int))


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
    penv: Callable[[int], str] = lambda pid: ""  # pid -> `ps eww` text (its command, then its environment)


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


def count_claude(o: dict, st: dict) -> None:
    """An assistant record's usage and calls into the log's totals. Claude writes a message once per content block,
    each with the message's usage (the last one wins), and may repeat it far down the log: messages count once by id,
    calls by their own id."""
    m, n = o["message"], st["n"]
    if m.get("model") == "<synthetic>" or not m.get("id"):
        return
    u = m.get("usage") if isinstance(m.get("usage"), dict) else {}
    # The advisor's requests ride in the message's usage.iterations, each with its own model.
    parts = [(m.get("model"), u)] + [(x.get("model"), x) for x in u.get("iterations") or ()
                                     if isinstance(x, dict) and x.get("type") == "advisor_message"]
    costs = [claude_cost(model, x) for model, x in parts]
    now = [sum(claude_tokens(x) for _, x in parts), None if None in costs else sum(costs)]
    was = n["msgs"].get(m["id"])
    for (tok, usd), sign in ((was, -1), (now, 1)) if was else ((now, 1),):
        n["tokens"] += sign * tok
        if usd is None:
            n["unpriced"] += sign
        else:
            n["cost"] += sign * usd
            n["priced"] += sign
    n["msgs"][m["id"]] = now
    for p in _parts(o):
        if p.get("type") == "tool_use" and p.get("id") and p["id"] not in n["calls"]:
            n["calls"][p["id"]] = 1
            n["tools"] += 1


def parse_claude(o: dict, st: dict, at: int, own: str | None = None) -> None:
    """One Claude transcript line into the log's state: edits (Edit/Write paths and the files a Bash command changed),
    calls still waiting for their result, and usage. own: an agent's own transcript counts only its session's records
    (a resume copies the earlier session's in)."""
    kind = o.get("type")
    if kind not in ("assistant", "user"):
        return
    if kind == "assistant" and isinstance(o.get("message"), dict) and (not own or o.get("sessionId") in (None, own)):
        count_claude(o, st)
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


def count_omp(u, st: dict) -> None:
    """omp records each request's tokens and its real cost."""
    if not isinstance(u, dict):
        return
    n = st["n"]
    tok = u.get("totalTokens") if isinstance(u.get("totalTokens"), int) else \
        sum(u.get(k) for k in ("input", "output", "cacheRead", "cacheWrite") if isinstance(u.get(k), int))
    n["tokens"] += tok
    usd = (u.get("cost") or {}).get("total") if isinstance(u.get("cost"), dict) else None
    if isinstance(usd, (int, float)):
        n["cost"] += usd
        n["priced"] += 1


def parse_omp(o: dict, st: dict, at: int) -> None:
    """One omp (pi format) line: written and edited paths, calls in flight with their intent, session_exit, usage and
    calls."""
    kind = o.get("type")
    if kind == "model_usage":  # side requests (titles): spend, not turns
        count_omp(o.get("usage"), st)
    elif kind == "session":
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
            count_omp(m.get("usage"), st)
            for p in _parts(o):
                if p.get("type") != "toolCall":
                    continue
                st["n"]["tools"] += 1
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


class Cache(dict):
    """Per log: {off, st}. Remembers which logs this run visited; the rest are gone and dropped on save."""

    def __init__(self, old: dict):
        super().__init__(old)
        self.visited = set()


def blank() -> dict:
    return {"edits": {}, "pending": {}, "done": False, "cwd": None,
            "n": {"tools": 0, "tokens": 0, "cost": 0.0, "priced": 0, "unpriced": 0, "msgs": {}, "calls": {}}}


# Lines worth parsing: the rest (attachments, snapshots, Claude's api-request copies) are most of a log's bytes.
KEYS = (b'"usage"', b'"tool_use"', b'"toolCall"', b'"tool_result"', b"bashEditDiff", b'"toolResult"', b'"session"', b"session_exit",
        b"tool_execution_start")


def read(path: str, cache: Cache, parse, mtime: int, tail: bool = False, final: bool = False) -> dict:
    """The log's state, after parsing only what was appended since the last run (complete lines only). A log that
    shrank is read again. An agent's own transcript (tail) is long: on a first read, only usage lines before its last
    TAIL bytes (totals need the whole session; edits and calls in flight only the end). A finished log (final) keeps
    its totals but not the ids it deduplicated by."""
    cache.visited.add(path)
    e = cache.get(path)
    size = os.path.getsize(path)
    if e and e.get("off") == size and not (final and e["st"]["n"]["msgs"]):  # all read (one just finished sheds its ids)
        return e["st"]
    fresh = not e or e.get("off", 0) > size
    if fresh:
        e = {"off": 0, "st": blank()}
    cut = size - TAIL if fresh and tail else 0
    with open(path, "rb") as f:
        f.seek(e["off"])
        chunk = f.read()
    end = chunk.rfind(b"\n") + 1
    pos = e["off"]
    for line in chunk[:end].split(b"\n"):
        at, pos = pos, pos + len(line) + 1
        if not any(k in line for k in (KEYS[:1] if at < cut else KEYS)) or line.startswith(b'{"type":"api-request'):
            continue
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if isinstance(o, dict):
            parse(o, e["st"], ms(o.get("timestamp"), mtime))
    st = e["st"]
    if final:
        st = {**st, "n": {**st["n"], "msgs": {}, "calls": {}}}
    cache[path] = {"off": e["off"] + end, "st": st}
    return st


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


def metrics(st: dict | None, kind: str) -> dict:
    """{tools, tokens, cost, costKind}: a cost only when every request had a price (kind: whose figure it is)."""
    n = st["n"] if st else blank()["n"]
    priced = n["priced"] > 0 and not n["unpriced"]
    return {"tools": n["tools"], "tokens": n["tokens"], "cost": round(n["cost"], 6) if priced else None,
            "costKind": kind if priced else None}


def subagent(sid, title, st, running, worktree, top, mtime, dirty, kind) -> dict:
    pending = list(st["pending"].values())
    return {"id": sid, "title": title, "running": running, "action": pending[-1] if running and pending else None,
            "edited": edited(st, worktree or top, dirty), "worktree": worktree, "updatedAt": mtime,
            "finishedAt": None if running else mtime, **metrics(st, kind)}


def approved_key(env: Env, pid: int) -> bool:
    """Is this Claude Code billed to an API key? It uses ANTHROPIC_API_KEY from its environment only once the person
    approved it (~/.claude.json keeps the last 20 characters of approved keys). Only the answer leaves here: the key is
    never printed, logged, cached or returned, and anything unreadable means no (a subscription)."""
    try:
        m = re.search(r"(?:^|\s)ANTHROPIC_API_KEY=(\S+)", env.penv(pid) or "")
        if not m:
            return False
        with open(os.path.join(env.home, ".claude.json"), encoding="utf-8") as f:
            approved = (json.load(f).get("customApiKeyResponses") or {}).get("approved") or []
        return m.group(1)[-20:] in approved
    except Exception:  # noqa: BLE001: whatever went wrong, it must not carry the key out in a message
        return False


def load(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def mtime_ms(p: str) -> int:
    return int(os.path.getmtime(p) * 1000)


def claude(a: dict, env: Env, cache: dict, dirty: Dirty) -> dict:
    """A Claude Code agent: its pid's tree -> ~/.claude/sessions/<pid>.json -> sessionId -> the transcript beside
    ~/.claude/projects/*/<sessionId>/subagents/agent-<id>.jsonl (+ .meta.json)."""
    sid, pid = None, None
    for p in env.procs(int(a["pid"])):
        f = os.path.join(env.home, ".claude", "sessions", f"{p.pid}.json")
        if os.path.isfile(f):
            sid, pid = (load(f) or {}).get("sessionId"), p.pid
            break
    out = {"edited": [], "subagents": [], **metrics(None, None)}
    if not sid:
        return out
    top, kind = a.get("top"), "api" if approved_key(env, pid) else "estimate"
    for log in glob.glob(os.path.join(env.home, ".claude", "projects", "*", f"{sid}.jsonl"))[:1]:
        st = read(log, cache, partial(parse_claude, own=sid), mtime_ms(log), tail=True)
        out = {**out, "edited": edited(st, top, dirty, env.now - RECENT), **metrics(st, kind)}
    for log in glob.glob(os.path.join(env.home, ".claude", "projects", "*", sid, "subagents", "agent-*.jsonl")):
        try:
            meta_f = log[:-6] + ".meta.json"
            meta = load(meta_f) if os.path.isfile(meta_f) else {}
            meta = meta if isinstance(meta, dict) else {}
            mt = mtime_ms(log)
            running = not meta.get("finished") and env.now - mt < STALE
            st = read(log, cache, parse_claude, mt, final=bool(meta.get("finished")))
            title = first_line(meta.get("description")) or first_line(meta.get("agentType")) or "Sub-agent"
            wt = meta.get("worktreePath") if isinstance(meta.get("worktreePath"), str) else None
            out["subagents"].append(subagent(os.path.basename(log)[6:-6], title, st, running, wt, top, mt, dirty, kind))
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
    out = {"edited": [], "subagents": [], **metrics(None, None)}
    if not session:
        return out
    top = a.get("top")
    st = read(session, cache, parse_omp, mtime_ms(session), tail=True)
    out = {**out, "edited": edited(st, top, dirty, env.now - RECENT), **metrics(st, "recorded")}
    root = session[:-6]
    for d, _, files in os.walk(root):
        for name in files:
            if not name.endswith(".jsonl") or name.startswith("__"):
                continue
            log = os.path.join(d, name)
            try:
                mt = mtime_ms(log)
                st = read(log, cache, parse_omp, mt)
                running = not st.get("done") and env.now - mt < STALE
                rel = os.path.relpath(log, root)[:-6]
                out["subagents"].append(subagent(rel, name[:-6], st, running, None, top, mt, dirty, "recorded"))
            except (OSError, ValueError) as ex:
                print(f"subagents: {log}: {type(ex).__name__}: {ex}", file=sys.stderr)
    return out


HARNESSES = {"claude": claude, "omp": omp}


def error(code: str, message: str) -> dict:
    return {"v": V, "error": {"code": code, "message": message}}


def cache_path(env: Env) -> str:
    return os.path.join(env.app, "data", "agent-graph", CACHE)


def scan(req, env: Env) -> dict:
    if not isinstance(req, list):
        return error("bad-request", "expected a list of agents")
    cache_f = cache_path(env)
    try:
        old = load(cache_f)
        old = old if isinstance(old, dict) else {}
    except (OSError, ValueError):
        old = {}
    cache, dirty, agents = Cache(old), Dirty(env), {}
    for a in req:
        fn = HARNESSES.get(a.get("harness")) if isinstance(a, dict) else None
        if not fn or not a.get("address"):
            continue
        try:
            agents[a["address"]] = fn(a, env, cache, dirty)
        except Exception as ex:  # one agent's bad file is that agent's error, never the panel's
            agents[a["address"]] = {"error": f"{type(ex).__name__}: {ex}"}
    kept = {k: v for k, v in cache.items() if k in cache.visited}  # logs this run visited; the rest are gone
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
        if not os.path.isdir(top):  # an isolated sub-agent's worktree, long removed
            return None
        # no index.lock: the agents in that worktree may be committing right now
        code, out = run(["git", "--no-optional-locks", "-C", top, "status", "--porcelain", "-z", "--untracked-files=all"])
        return out if code == 0 else None

    def penv(pid: int) -> str:
        return run(["ps", "eww", "-o", "command=", "-p", str(pid)])[1]

    return Env(home=home, app=os.environ.get("HERDR_APP_HOME") or os.path.join(home, ".config", "herdr-app"),
               now=int(time.time() * 1000), procs=procs, git_status=git_status, penv=penv)


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
