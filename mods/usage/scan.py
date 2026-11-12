#!/usr/bin/env python3
"""Scan local coding-agent session data (omp, Claude Code, Codex, OpenCode, pi)
and print one JSON document of per-session usage records to stdout.

Only counters, model ids, timestamps and repo paths leave this script: never
prompt text, titles, tool arguments or outputs. Parsed records are cached per
source file so warm runs only re-read files that changed, and records whose
source file disappeared (Claude prunes history after ~30 days) stay cached.
"""
import argparse
import bisect
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

CACHE_VERSION = 4
EFFORTS = {"off", "minimal", "low", "medium", "high", "xhigh", "max"}
# Envelope timestamp. JSON escapes quotes inside strings, so this only matches structural keys.
TS = re.compile(rb'"timestamp":"(\d{4}-[^"]+)"')
COMMIT_GRACE_MS = 30 * 60 * 1000
COMMIT_WINDOW_MS = 8 * 3600 * 1000
TOOL_CATS = {
    **dict.fromkeys(("edit", "write", "multiedit", "notebookedit", "apply_patch", "patch", "ast_edit",
                     "create_file"), "edit"),
    **dict.fromkeys(("read", "grep", "glob", "find", "ls", "list", "search", "lsp", "view"), "read"),
    **dict.fromkeys(("bash", "shell", "exec_command", "local_shell", "eval", "python", "run", "terminal",
                     "debug"), "bash"),
    **dict.fromkeys(("webfetch", "websearch", "web_search", "fetch", "browser"), "web"),
    **dict.fromkeys(("task", "agent", "subagent"), "agent"),
}
TOOL_PREFIXES = (("str_replace", "edit"), ("web_", "web"), ("spawn", "agent"), ("dispatch", "agent"))


def norm_effort(v):
    v = str(v or "").lower()
    v = {"none": "off", "x-high": "xhigh"}.get(v, v)
    return v if v in EFFORTS else None


def iso_ms(s):
    if isinstance(s, bytes):
        s = s.decode()
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)


def tool_cat(name):
    n = str(name or "").lower()
    return TOOL_CATS.get(n) or next((c for p, c in TOOL_PREFIXES if n.startswith(p)), "other")


def blank(h, sid, sub):
    return {"h": h, "id": sid, "start": None, "end": None, "cwd": None, "sub": sub,
            "models": {}, "effort": None, "tok": 0, "tin": 0, "tout": 0, "tcr": 0, "tcw": 0,
            "cost": 0.0, "req": 0, "tools": 0, "toolErr": 0,
            "tc": dict.fromkeys(("edit", "read", "bash", "web", "agent", "other"), 0),
            "aborts": 0, "apiErr": 0, "compactions": 0}


def add_tool(r, name):
    r["tools"] += 1
    r["tc"][tool_cat(name)] += 1


def add_usage(r, model, tin, tout, tcr, tcw, cost=0):
    tin, tout, tcr, tcw = tin or 0, tout or 0, tcr or 0, tcw or 0
    t = tin + tout + tcr + tcw
    r["tin"] += tin
    r["tout"] += tout
    r["tcr"] += tcr
    r["tcw"] += tcw
    r["tok"] += t
    r["cost"] += cost or 0
    if model and t:
        r["models"][model] = r["models"].get(model, 0) + t


def finish(r, efforts):
    r["effort"] = efforts.most_common(1)[0][0] if efforts else None
    r["cost"] = round(r["cost"], 6) or None  # 0 = nothing recorded (e.g. subscription auth)
    return r


def span(r, lo, hi):
    if lo:
        r["start"], r["end"] = iso_ms(lo), iso_ms(hi)


# ---------- omp / pi ----------

def parse_pi(path, h, sub):
    """omp and pi share the pi session format; pi just records fewer fields."""
    r = blank(h, os.path.basename(path)[:-6], sub)
    eff, level, lo, hi = Counter(), None, None, None
    with open(path, "rb") as f:
        for line in f:
            m = TS.search(line, 0, 400)
            if m:
                ts = m.group(1)
                lo = ts if lo is None or ts < lo else lo
                hi = ts if hi is None or ts > hi else hi
            head = line[:400]
            try:
                if line.startswith(b'{"type":"message"'):
                    if b'"role":"assistant"' in head:
                        msg = json.loads(line).get("message") or {}
                        u = msg.get("usage") or {}
                        add_usage(r, msg.get("model"), u.get("input"), u.get("output"),
                                  u.get("cacheRead"), u.get("cacheWrite"), (u.get("cost") or {}).get("total"))
                        r["req"] += 1
                        stop = msg.get("stopReason")
                        r["aborts"] += stop == "aborted"
                        r["apiErr"] += stop == "error"
                        e = norm_effort(((msg.get("requestControls") or {}).get("effort") or {}).get("topLevel")) or level
                        if e:
                            eff[e] += 1
                        for c in msg.get("content") or ():
                            if isinstance(c, dict) and c.get("type") == "toolCall":
                                add_tool(r, c.get("name"))
                    elif b'"role":"toolResult"' in head:
                        # isError sits after content/details, near the end of the line
                        r["toolErr"] += b'"isError":true' in line[-300:]
                elif b'"type":"session"' in head[:40]:
                    o = json.loads(line)
                    r["id"] = o.get("id") or r["id"]
                    r["cwd"] = o.get("cwd")
                elif b'"type":"thinking_level_change"' in head[:60]:
                    level = norm_effort(json.loads(line).get("thinkingLevel"))
                elif b'"type":"compaction"' in head[:40]:
                    r["compactions"] += 1
                elif b'"type":"model_usage"' in head[:40]:  # side requests (titles, probes): spend, not turns
                    o = json.loads(line)
                    u = o.get("usage") or {}
                    add_usage(r, o.get("model"), u.get("input"), u.get("output"),
                              u.get("cacheRead"), u.get("cacheWrite"), (u.get("cost") or {}).get("total"))
            except ValueError:
                continue
    span(r, lo, hi)
    return [finish(r, eff)]


# ---------- Claude Code ----------

CLAUDE_KEYS = (b'"type":"assistant"', b'"is_error":true', b'"interrupted":true',
               b'"text":"[Request interrupted by user', b'"subtype":"api_error"',
               b'"subtype":"compact_boundary"', b'"type":"cost-state"')
INTERRUPT = "[Request interrupted by user"  # fixed marker Claude writes on Esc; not user prose


def parse_claude(path, sub):
    sid = os.path.basename(path)[:-6]
    r = blank("claude", sid, sub)
    msgs, tools, cost, lo, hi = {}, {}, None, None, None
    # resuming copies earlier records (keeping their old sessionId) into the new session file;
    # those belong to the original session, so a top-level file only counts its own records
    own = None if sub else f'"sessionId":"{sid}"'.encode()
    with open(path, "rb") as f:
        for line in f:
            if own and own not in line and b'"sessionId":"' in line:
                continue
            m = TS.search(line)
            if m:
                ts = m.group(1)
                lo = ts if lo is None or ts < lo else lo
                hi = ts if hi is None or ts > hi else hi
            if not any(k in line for k in CLAUDE_KEYS):
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            t = o.get("type")
            if t == "assistant":
                r["cwd"] = r["cwd"] or o.get("cwd")
                msg = o.get("message") or {}
                # streamed responses repeat one message id across records; last usage wins
                msgs[msg.get("id") or o.get("uuid")] = (msg.get("model"), msg.get("usage") or {},
                                                        o.get("perTurnEffort") or o.get("effort"))
                for c in msg.get("content") or ():
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        tools[c.get("id")] = c.get("name")
            elif t == "user":
                content = (o.get("message") or {}).get("content")
                content = content if isinstance(content, list) else ()
                r["toolErr"] += sum(1 for c in content if isinstance(c, dict)
                                    and c.get("type") == "tool_result" and c.get("is_error") is True)
                tur = o.get("toolUseResult")
                r["aborts"] += (isinstance(tur, dict) and tur.get("interrupted") is True) or any(
                    isinstance(c, dict) and c.get("type") == "text" and str(c.get("text")).startswith(INTERRUPT)
                    for c in content)
            elif t == "system":
                r["apiErr"] += o.get("subtype") == "api_error"
                r["compactions"] += o.get("subtype") == "compact_boundary"
            elif t == "cost-state":
                cost = o.get("totalCostUSD")
    eff = Counter()
    for model, u, e in msgs.values():
        add_usage(r, model, u.get("input_tokens"), u.get("output_tokens"),
                  u.get("cache_read_input_tokens"), u.get("cache_creation_input_tokens"))
        e = norm_effort(e)
        if e:
            eff[e] += 1
    for name in tools.values():
        add_tool(r, name)
    r["req"], r["cost"] = len(msgs), cost or 0
    span(r, lo, hi)
    return [finish(r, eff)]


# ---------- Codex ----------

CODEX_KEYS = (b'"type":"token_count"', b'"type":"function_call"', b'"type":"custom_tool_call"',
              b'"type":"local_shell_call"', b'"type":"web_search_call"', b'"type":"turn_aborted"',
              b'"type":"compacted"')
CODEX_TOOLS = ("function_call", "custom_tool_call", "local_shell_call", "web_search_call")


def rollout_lines(path):
    if path.endswith(".zst"):
        if not shutil.which("zstd"):
            return None
        p = subprocess.run(["zstd", "-dcq", path], capture_output=True)
        return p.stdout.splitlines() if p.returncode == 0 else None  # corrupt: fall back to the db row
    with open(path, "rb") as f:
        return f.read().splitlines()


def codex_record(row, path):
    tid, start, end, source, model, effort, tokens, cwd = row
    sub = "subagent" in (source or "")
    r = blank("codex", tid, sub)
    r.update(start=int(start), end=int(end), cwd=cwd, tok=tokens or 0,
             tin=None, tout=None, tcr=None, tcw=None, cost=None, effort=norm_effort(effort))
    if model and tokens:
        r["models"] = {model: tokens}
    lines = rollout_lines(path) if path and os.path.exists(path) else None
    if lines is None:
        return [r]
    usage = None
    for line in lines:
        if not any(k in line for k in CODEX_KEYS):
            continue
        try:
            o = json.loads(line)
        except ValueError:
            continue
        p = o.get("payload") if isinstance(o.get("payload"), dict) else {}
        pt = p.get("type") if o.get("type") in ("event_msg", "response_item") else o.get("type")
        if pt == "token_count" and p.get("info"):
            u = p["info"].get("total_token_usage")
            if u and u != usage:  # token_count repeats between requests; a change = one request
                r["req"] += 1
                usage = u
        elif pt in CODEX_TOOLS:
            add_tool(r, p.get("name") or pt[:-5])  # local_shell_call -> local_shell, web_search_call -> web_search
        elif pt == "turn_aborted":
            r["aborts"] += 1
        elif pt == "compacted":
            r["compactions"] += 1
    if usage:
        cached, cw = usage.get("cached_input_tokens") or 0, usage.get("cache_write_input_tokens") or 0
        r.update(tin=max((usage.get("input_tokens") or 0) - cached - cw, 0), tout=usage.get("output_tokens") or 0,
                 tcr=cached, tcw=cw)
        r["tok"] = r["tin"] + r["tout"] + r["tcr"] + r["tcw"]
        if model:
            r["models"] = {model: r["tok"]}
    return [r]


def scan_codex(home, cache, seen):
    db = os.path.join(home, ".codex", "state_5.sqlite")
    if not os.path.exists(db):
        return
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = con.execute("select id, rollout_path, created_at*1000, updated_at*1000, source, model,"
                           " reasoning_effort, tokens_used, cwd from threads").fetchall()
    finally:
        con.close()
    has_zstd = bool(shutil.which("zstd"))  # installing zstd later re-parses compressed rollouts
    for tid, path, *rest in rows:
        row = (tid, *rest)
        if path and not os.path.exists(path) and os.path.exists(path + ".zst"):
            path += ".zst"  # Codex compresses old rollouts in place without updating the row
        # keyed per thread, so compressing a rollout replaces its entry instead of duplicating it;
        # the row changes with the thread, so it is part of the freshness stamp
        cached(cache, seen, f"{db}#{tid}",
               lambda: [stamp(path) if path and os.path.exists(path) else None, rest[1], rest[5], has_zstd],
               lambda: codex_record(row, path))


# ---------- OpenCode ----------

def parse_opencode(db):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        sessions = con.execute("select id, parent_id, directory, time_created, time_updated from session").fetchall()
        msgs = con.execute(
            "select session_id, json_extract(data,'$.role'), json_extract(data,'$.modelID'),"
            " json_extract(data,'$.variant'), json_extract(data,'$.error.name'),"
            " json_extract(data,'$.tokens.input'), json_extract(data,'$.tokens.output'),"
            " json_extract(data,'$.tokens.reasoning'), json_extract(data,'$.tokens.cache.read'),"
            " json_extract(data,'$.tokens.cache.write'), json_extract(data,'$.cost') from message").fetchall()
        parts = con.execute(
            "select session_id, t, tool, count(*), sum(s='error') from"
            " (select session_id, json_extract(data,'$.type') t, json_extract(data,'$.tool') tool,"
            " json_extract(data,'$.state.status') s from part) where t in ('tool','compaction')"
            " group by session_id, t, tool").fetchall()
    finally:
        con.close()
    recs, effs = {}, {}
    for sid, parent, cwd, t0, t1 in sessions:
        r = recs[sid] = blank("opencode", sid, parent is not None)
        r.update(start=t0, end=t1, cwd=cwd)
        effs[sid] = Counter()
    for sid, role, model, variant, err, tin, tout, reason, tcr, tcw, cost in msgs:
        r = recs.get(sid)
        if r is None:
            continue
        e = norm_effort(variant)
        if e:
            effs[sid][e] += 1
        if role == "assistant":
            r["req"] += 1
            r["aborts"] += err == "MessageAbortedError"
            r["apiErr"] += err == "APIError"
            add_usage(r, model, tin, (tout or 0) + (reason or 0), tcr, tcw, cost)
    for sid, t, tool, n, err in parts:
        r = recs.get(sid)
        if r is None:
            continue
        if t == "compaction":
            r["compactions"] += n
        else:
            r["tools"] += n
            r["tc"][tool_cat(tool)] += n
            r["toolErr"] += err or 0
    return [finish(r, effs[sid]) for sid, r in recs.items()]


# ---------- cache + discovery ----------

def stamp(path):
    s = os.stat(path)
    return [s.st_mtime_ns, s.st_size]


def cached(cache, seen, key, st, parse):
    """st and parse are callables so a file vanishing mid-walk only skips that file."""
    seen.add(key)
    try:
        st = st()
        e = cache.get(key)
        if not e or e["st"] != st:
            cache[key] = {"st": st, "r": parse()}
    except Exception as ex:  # one bad file must not drop the rest
        print(f"usage scan: {key}: {type(ex).__name__}: {ex}", file=sys.stderr)


def scan_tree(root, cache, seen, parse):
    """Session files at <root>/<slug>/<file>.jsonl; anything nested deeper is a sub-agent."""
    for d, _, files in os.walk(root):
        sub = os.path.relpath(d, root).count(os.sep) > 0
        for name in files:
            if name.endswith(".jsonl"):
                p = os.path.join(d, name)
                cached(cache, seen, p, lambda: stamp(p), lambda: parse(p, sub))


def scan_opencode(home, cache, seen):
    db = os.path.join(home, ".local", "share", "opencode", "opencode.db")
    if os.path.exists(db):
        wal = db + "-wal"
        cached(cache, seen, db, lambda: [stamp(db), stamp(wal) if os.path.exists(wal) else None],
               lambda: parse_opencode(db))


HARNESSES = {
    "omp": lambda home, c, s: scan_tree(os.path.join(home, ".omp", "agent", "sessions"), c, s,
                                        lambda p, sub: parse_pi(p, "omp", sub)),
    "claude": lambda home, c, s: scan_tree(os.path.join(home, ".claude", "projects"), c, s, parse_claude),
    "codex": scan_codex,
    "opencode": scan_opencode,
    "pi": lambda home, c, s: scan_tree(os.path.join(home, ".pi", "agent", "sessions"), c, s,
                                       lambda p, sub: parse_pi(p, "pi", sub)),
}


def load_cache(path):
    try:
        with open(path) as f:
            c = json.load(f)
        return c["files"] if c.get("v") == CACHE_VERSION else {}
    except (OSError, ValueError, KeyError, AttributeError):
        return {}


def save_cache(path, files):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump({"v": CACHE_VERSION, "files": files}, f, separators=(",", ":"))
    os.replace(tmp, path)


# ---------- git ----------

def git(*args):
    p = subprocess.run(["git", *args], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else None


def repo_of(cwd):
    if not cwd or not os.path.isdir(cwd):
        return None
    out = git("-C", cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir")
    if not out or len(out.split("\n")) < 2:
        return None
    top, common = out.split("\n")[:2]
    # worktrees share <main>/.git as common dir: report the main checkout
    return os.path.dirname(common) if os.path.basename(common) == ".git" else top


def commit_times(repo):
    """The user's own commits only: teammates' fetched commits are not the session's work."""
    email = (git("-C", repo, "config", "user.email") or "").strip()
    author = ["--fixed-strings", f"--author={email}"] if email else []
    out = git("-C", repo, "log", "--all", *author, "--format=%ct")
    return sorted(int(x) for x in out.split()) if out else []


# ---------- main ----------

def scan(home):
    app = os.environ.get("HERDR_APP_HOME") or os.path.join(home, ".config", "herdr-app")
    cache_path = os.path.join(app, "data", "usage", "cache.json")
    cache, seen = load_cache(cache_path), set()
    for name, fn in HARNESSES.items():
        try:
            fn(home, cache, seen)
        except Exception as ex:
            print(f"usage scan: {name}: {type(ex).__name__}: {ex}", file=sys.stderr)
            seen.update(k for k, e in cache.items() if any(r["h"] == name for r in e["r"]))  # keep its sessions
    # keep vanished sources (pruned history); drop entries whose source still exists but was not seen
    cache = {k: v for k, v in cache.items() if k in seen or not os.path.exists(k.split("#")[0])}
    save_cache(cache_path, cache)

    # forks copy Claude sub-agent transcripts verbatim into the new session's folder: keep one per id
    uniq_recs = {}
    for e in cache.values():
        for r in e["r"]:
            k = (r["h"], r["id"])
            if r["start"] is not None and (r["req"] or r["tok"]) and (
                    k not in uniq_recs or r["req"] > uniq_recs[k]["req"]):
                uniq_recs[k] = r
    recs = list(uniq_recs.values())
    cwds = {r["cwd"] for r in recs}
    with ThreadPoolExecutor(8) as ex:
        repos = dict(zip(cwds, ex.map(repo_of, cwds)))
        uniq = {v for v in repos.values() if v}
        times = dict(zip(uniq, ex.map(commit_times, uniq)))
    out = []
    for r in recs:
        repo = repos[r["cwd"]]
        commits = None
        if repo:
            ts = times[repo]
            # resumed multi-day sessions: only the first COMMIT_WINDOW_MS of a session can claim commits
            hi = min(r["end"], r["start"] + COMMIT_WINDOW_MS) + COMMIT_GRACE_MS
            commits = bisect.bisect_right(ts, hi / 1000) - bisect.bisect_left(ts, r["start"] / 1000)
        out.append({"h": r["h"], "id": r["id"], "start": r["start"], "end": r["end"], "repo": repo,
                    "sub": r["sub"], "models": r["models"], "effort": r["effort"], "tok": r["tok"],
                    "tin": r["tin"], "tout": r["tout"], "tcr": r["tcr"], "tcw": r["tcw"], "cost": r["cost"],
                    "req": r["req"], "tools": r["tools"], "toolErr": r["toolErr"], "tc": r["tc"], "aborts": r["aborts"],
                    "apiErr": r["apiErr"], "compactions": r["compactions"], "commits": commits})
    return {"scanned_at": int(time.time() * 1000), "sessions": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--home", default=os.path.expanduser("~"), help="replaces ~ for all sources (tests)")
    json.dump(scan(ap.parse_args().home), sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
