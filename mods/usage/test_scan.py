import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scan  # noqa: E402

T = 1_790_000_000  # session start, epoch seconds


def iso(sec):
    return datetime.fromtimestamp(sec, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def jsonl(path, entries):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("not json\n")  # malformed lines are skipped
        for e in entries:
            f.write(json.dumps(e, separators=(",", ":")) + "\n")


def git_repo(path):
    os.makedirs(path)
    g = ["git", "-C", path, "-c", "commit.gpgsign=false"]
    subprocess.run(g + ["init", "-q"], check=True)
    subprocess.run(g + ["config", "user.email", "t@t"], check=True)
    commits = [(sec, "t@t") for sec in (T - 60, T + 10, T + 3600 + 20 * 60, T + 3600 + 40 * 60, T + 10 * 3600)]
    for sec, email in commits + [(T + 20, "mate@t")]:  # a teammate's commit never counts
        env = dict(os.environ, GIT_AUTHOR_DATE=f"@{sec} +0000", GIT_COMMITTER_DATE=f"@{sec} +0000",
                   GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL=email, GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL=email)
        subprocess.run(g + ["commit", "-q", "--allow-empty", "-m", "c"], check=True, env=env)


def omp_entries(cwd, sid):
    def msg(sec, m):
        return {"type": "message", "id": "x", "parentId": None, "timestamp": iso(sec), "message": m}
    usage = {"input": 10, "output": 5, "cacheRead": 100, "cacheWrite": 1, "totalTokens": 116, "cost": {"total": 0.5}}
    return [
        {"type": "title", "title": "secret"},
        {"type": "session", "version": 3, "id": sid, "timestamp": iso(T), "cwd": cwd},
        {"type": "thinking_level_change", "id": "x", "timestamp": iso(T), "thinkingLevel": "high"},
        msg(T + 60, {"role": "assistant", "model": "m1", "usage": usage, "stopReason": "toolUse",
                     "content": [{"type": "toolCall", "name": "bash"}, {"type": "toolCall", "name": "Edit"}]}),
        msg(T + 61, {"role": "toolResult", "toolName": "bash", "content": [{"type": "text", "text": "\"isError\":true"}],
                     "isError": False}),
        msg(T + 62, {"role": "toolResult", "toolName": "bash", "content": [], "isError": True}),
        msg(T + 63, {"role": "assistant", "model": "m1", "usage": usage, "stopReason": "aborted",
                     "requestControls": {"effort": {"topLevel": "MAX"}},
                     "content": [{"type": "toolCall", "name": n} for n in ("read", "web_fetch", "task", "todo_write")]}),
        msg(T + 64, {"role": "assistant", "model": "m2", "usage": usage, "stopReason": "error"}),
        {"type": "compaction", "id": "x", "timestamp": iso(T + 65), "summary": "s"},
        {"type": "model_usage", "id": "x", "timestamp": iso(T + 66), "model": "m3", "usage": usage},
        msg(T + 3600, {"role": "user", "content": "hi"}),
    ]


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.realpath(self.tmp.name)
        os.environ["HERDR_APP_HOME"] = os.path.join(self.home, "app")
        self.repo = os.path.join(self.home, "repo")
        git_repo(self.repo)
        h = self.home

        # omp: top-level session + nested sub-agent
        omp = os.path.join(h, ".omp/agent/sessions/-slug-")
        jsonl(f"{omp}/2026_ompmain.jsonl", omp_entries(self.repo, "omp-main"))
        jsonl(f"{omp}/2026_ompmain/Sub.jsonl", omp_entries(self.repo, "omp-sub"))

        # pi: cwd that no longer exists
        jsonl(os.path.join(h, ".pi/agent/sessions/--x--/2026_pi.jsonl"), omp_entries("/nonexistent/dir", "pi-1"))

        # Claude: streamed duplicates share a message id; sub-agent under <uuid>/subagents/
        def a(sec, mid, out, effort="High", content=()):
            return {"type": "assistant", "timestamp": iso(sec), "cwd": self.repo, "effort": effort,
                    "message": {"id": mid, "model": "opus", "content": list(content),
                                "usage": {"input_tokens": 1, "output_tokens": out, "cache_read_input_tokens": 10,
                                          "cache_creation_input_tokens": 2}}}
        claude = [
            {"type": "last-prompt", "lastPrompt": "secret"},
            {"type": "user", "timestamp": iso(T), "message": {"role": "user", "content": "hi"}},
            a(T + 1, "m1", 3, content=[{"type": "tool_use", "id": "t1", "name": "Bash"}]),
            a(T + 2, "m1", 7, content=[{"type": "tool_use", "id": "t2", "name": "MultiEdit"}]),
            {"type": "user", "timestamp": iso(T + 3), "toolUseResult": {"interrupted": True},
             "message": {"content": [{"type": "tool_result", "is_error": True}, {"type": "tool_result", "is_error": False}]}},
            {"type": "user", "timestamp": iso(T + 4),
             "message": {"content": [{"type": "text", "text": "[Request interrupted by user]"}]}},
            {"type": "api-request-blob", "message": {"content": [{"type": "tool_result", "is_error": True}]}},
            a(T + 5, "m2", 1, effort="medium", content=[{"type": "tool_use", "id": f"t{n}", "name": n} for n in (
                "WebFetch", "Agent", "str_replace_based_edit_tool", "TodoWrite", "Grep")]),
            a(T + 6, "m3", 1, effort="xhigh"),
            a(T + 7, "m4", 1, effort="xhigh"),
            {"type": "system", "subtype": "api_error", "timestamp": iso(T + 8)},
            {"type": "system", "subtype": "compact_boundary", "timestamp": iso(T + 9)},
            {"type": "cost-state", "totalCostUSD": 1.25},
        ]
        self.claude_main = os.path.join(h, ".claude/projects/-slug/uuid-1.jsonl")
        jsonl(self.claude_main, claude)
        jsonl(os.path.join(h, ".claude/projects/-slug/uuid-1/subagents/agent-a1.jsonl"), claude[:4])

        # Codex: threads table + plain rollout
        os.makedirs(os.path.join(h, ".codex"))
        rollout = self.rollout = os.path.join(h, ".codex/rollout-1.jsonl")
        tc = lambda i, o: {"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {
            "input_tokens": i, "cached_input_tokens": 50, "cache_write_input_tokens": 5, "output_tokens": o,
            "total_tokens": i + o}}}}
        jsonl(rollout, [tc(80, 10), tc(80, 10), tc(100, 20),
                        {"type": "response_item", "payload": {"type": "function_call", "name": "shell"}},
                        {"type": "response_item", "payload": {"type": "function_call_output", "output": "x"}},
                        {"type": "event_msg", "payload": {"type": "turn_aborted"}},
                        {"type": "compacted", "payload": {"message": ""}}])
        con = sqlite3.connect(os.path.join(h, ".codex/state_5.sqlite"))
        con.execute("create table threads (id, rollout_path, created_at, updated_at, source, model,"
                    " reasoning_effort, tokens_used, cwd, title)")
        con.executemany("insert into threads values (?,?,?,?,?,?,?,?,?,?)", [
            ("c1", rollout, T, T + 3600, "cli", "gpt", "XHigh", 120, self.repo, "secret"),
            ("c2", None, T, T + 60, '{"subagent":"review"}', "gpt", "none", 7, None, "secret"),
            ("c3", None, T, T + 20 * 3600, "cli", "gpt", "high", 9, self.repo, "secret"),  # resumed for 20 h
        ])
        con.commit()
        con.close()

        # OpenCode
        db = os.path.join(h, ".local/share/opencode/opencode.db")
        os.makedirs(os.path.dirname(db))
        con = sqlite3.connect(db)
        con.execute("create table session (id, parent_id, directory, time_created, time_updated, title)")
        con.execute("create table message (id, session_id, data)")
        con.execute("create table part (id, session_id, data)")
        con.executemany("insert into session values (?,?,?,?,?,?)", [
            ("s1", None, self.repo, T * 1000, (T + 100) * 1000, "secret"),
            ("s2", "s1", self.repo, T * 1000, (T + 50) * 1000, "secret")])
        tok = {"input": 1, "output": 2, "reasoning": 3, "cache": {"read": 4, "write": 5}}
        msgs = [("s1", {"role": "user", "variant": "max"}),
                ("s1", {"role": "assistant", "modelID": "glm", "variant": "max", "tokens": tok, "cost": 0}),
                ("s1", {"role": "assistant", "modelID": "glm", "tokens": tok, "error": {"name": "MessageAbortedError"}}),
                ("s2", {"role": "assistant", "modelID": "glm", "tokens": tok, "error": {"name": "APIError"}})]
        con.executemany("insert into message values (?,?,?)", [(str(i), s, json.dumps(d)) for i, (s, d) in enumerate(msgs)])
        parts = [{"type": "tool", "state": {"status": "completed"}}, {"type": "tool", "state": {"status": "error"}},
                 {"type": "compaction", "auto": True}, {"type": "text", "text": "secret"}]
        con.executemany("insert into part values (?,?,?)", [(str(i), "s1", json.dumps(d)) for i, d in enumerate(parts)])
        con.commit()
        con.close()

    def tearDown(self):
        os.environ.pop("HERDR_APP_HOME", None)
        self.tmp.cleanup()

    def by_id(self):
        out = scan.scan(self.home)
        self.assertNotIn("secret", json.dumps(out))
        return {r["id"]: r for r in out["sessions"]}

    def test_omp(self):
        r = self.by_id()
        m = r["omp-main"]
        self.assertEqual((m["h"], m["sub"], r["omp-sub"]["sub"]), ("omp", False, True))
        self.assertEqual((m["start"], m["end"]), (T * 1000, (T + 3600) * 1000))
        self.assertEqual(m["repo"], self.repo)
        self.assertEqual(m["commits"], 2)  # T+10 and end+20min; not T-60 nor end+40min
        self.assertEqual((m["req"], m["tools"], m["toolErr"], m["aborts"], m["apiErr"], m["compactions"]),
                         (3, 6, 1, 1, 1, 1))
        self.assertEqual(m["tc"], {"edit": 1, "read": 1, "bash": 1, "web": 1, "agent": 1, "other": 1})
        self.assertEqual((m["tok"], m["tin"], m["tout"], m["tcr"], m["tcw"]), (464, 40, 20, 400, 4))
        self.assertEqual(m["models"], {"m1": 232, "m2": 116, "m3": 116})
        self.assertEqual(m["cost"], 2.0)
        self.assertEqual(m["effort"], "high")  # thinkingLevel high x2 beats requestControls MAX x1

    def test_pi_missing_cwd(self):
        p = self.by_id()["pi-1"]
        self.assertEqual((p["h"], p["repo"], p["commits"], p["sub"]), ("pi", None, None, False))

    def test_claude(self):
        r = self.by_id()
        c, s = r["uuid-1"], r["agent-a1"]
        self.assertEqual((c["sub"], s["sub"]), (False, True))
        self.assertEqual(c["req"], 4)  # m1 streamed twice counts once
        self.assertEqual((c["tok"], c["tout"]), (7 + 3 * 1 + 4 * 13, 10))  # m1 keeps its last usage
        self.assertEqual((c["tools"], c["toolErr"], c["aborts"], c["apiErr"], c["compactions"]), (7, 1, 2, 1, 1))
        self.assertEqual(c["tc"], {"edit": 2, "read": 1, "bash": 1, "web": 1, "agent": 1, "other": 1})
        self.assertEqual(s["tc"], {"edit": 1, "read": 0, "bash": 1, "web": 0, "agent": 0, "other": 0})
        self.assertEqual((c["effort"], c["cost"], s["cost"]), ("xhigh", 1.25, None))

    def test_codex(self):
        r = self.by_id()
        c, sub = r["c1"], r["c2"]
        self.assertEqual((c["sub"], sub["sub"]), (False, True))
        self.assertEqual((c["tin"], c["tcr"], c["tcw"], c["tout"], c["tok"]), (45, 50, 5, 20, 120))
        self.assertEqual((c["req"], c["tools"], c["aborts"], c["compactions"]), (2, 1, 1, 1))
        self.assertEqual(c["tc"]["bash"], 1)  # function_call "shell"
        self.assertEqual((c["effort"], c["models"], c["cost"], c["commits"]), ("xhigh", {"gpt": 120}, None, 2))
        self.assertEqual(r["c3"]["commits"], 3)  # window capped at start+8h+30min: T+10h is out
        self.assertEqual((sub["tok"], sub["tin"], sub["effort"], sub["repo"]), (7, None, "off", None))

    def test_opencode(self):
        r = self.by_id()
        s1, s2 = r["s1"], r["s2"]
        self.assertEqual((s1["sub"], s2["sub"]), (False, True))
        self.assertEqual((s1["req"], s1["tok"], s1["tout"], s1["models"]), (2, 30, 10, {"glm": 30}))
        self.assertEqual((s1["tools"], s1["toolErr"], s1["compactions"], s1["aborts"]), (2, 1, 1, 1))
        self.assertEqual((s1["effort"], s1["cost"], s2["apiErr"]), ("max", None, 1))

    def test_cache_keeps_vanished_and_reparses_changed(self):
        self.by_id()
        os.remove(self.claude_main)
        os.remove(os.path.join(self.home, ".pi/agent/sessions/--x--/2026_pi.jsonl"))
        jsonl(os.path.join(self.home, ".omp/agent/sessions/-slug-/2026_ompmain.jsonl"), omp_entries(self.repo, "omp-new"))
        r = self.by_id()
        self.assertIn("uuid-1", r)
        self.assertIn("pi-1", r)
        self.assertIn("omp-new", r)
        self.assertNotIn("omp-main", r)

    def test_codex_compressed_rollout_replaces_entry(self):
        self.by_id()
        os.remove(self.rollout)
        with open(self.rollout + ".zst", "wb") as f:
            f.write(b"corrupt")  # unreadable .zst falls back to the db row
        ids = [s["id"] for s in scan.scan(self.home)["sessions"]]
        self.assertEqual(ids.count("c1"), 1)
        c = self.by_id()["c1"]
        self.assertEqual((c["tok"], c["tin"], c["req"]), (120, None, 0))

    def test_failing_harness_keeps_cached_sessions(self):
        self.by_id()
        boom = mock.Mock(side_effect=RuntimeError("boom"))
        with mock.patch.dict(scan.HARNESSES, claude=boom), mock.patch("sys.stderr"):
            r = self.by_id()
        self.assertIn("uuid-1", r)
        self.assertIn("agent-a1", r)

    def test_claude_resume_copies_not_double_counted(self):
        proj = os.path.join(self.home, ".claude/projects/-slug")
        rec = lambda sid, mid, sec: {"type": "assistant", "sessionId": sid, "timestamp": iso(sec), "cwd": self.repo,
                                     "message": {"id": mid, "model": "opus", "usage": {"output_tokens": 5}}}
        jsonl(f"{proj}/uuid-2.jsonl", [rec("uuid-1", "old1", T - 9000), rec("uuid-2", "new1", T)])
        with open(os.path.join(proj, "uuid-1/subagents/agent-a1.jsonl")) as src:
            os.makedirs(f"{proj}/uuid-2/subagents")
            with open(f"{proj}/uuid-2/subagents/agent-a1.jsonl", "w") as dst:
                dst.write(src.read())
        out = scan.scan(self.home)["sessions"]
        self.assertEqual([s["id"] for s in out].count("agent-a1"), 1)
        r = {s["id"]: s for s in out}["uuid-2"]
        self.assertEqual((r["tok"], r["req"], r["start"]), (5, 1, T * 1000))


if __name__ == "__main__":
    unittest.main()
