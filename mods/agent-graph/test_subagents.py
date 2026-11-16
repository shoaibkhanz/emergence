import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import subagents as sa  # noqa: E402

NOW = 1_790_000_000_000  # ms
MIN = 60_000


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def jsonl(path, entries, mtime=NOW):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        f.write("not json\n")  # malformed lines are skipped
        for e in entries:
            f.write(json.dumps(e) + "\n")
    os.utime(path, (mtime / 1000, mtime / 1000))


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f)


# Claude Code transcript lines.
def use(at, tid, name, inp, cwd="/w"):
    return {"type": "assistant", "timestamp": iso(at), "cwd": cwd,
            "message": {"content": [{"type": "text", "text": "SECRET_PROMPT"}, {"type": "tool_use", "id": tid, "name": name, "input": inp}]}}


def result(at, tid, extra=None):
    return {"type": "user", "timestamp": iso(at), "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": "SECRET_OUTPUT"}]},
            **({"toolUseResult": extra} if extra else {})}


# omp session lines.
def call(at, cid, name, args, intent=None):
    return {"type": "message", "timestamp": iso(at), "message": {"role": "assistant", "content": [
        {"type": "toolCall", "id": cid, "name": name, "arguments": args, **({"intent": intent} if intent else {})}]}}


def oresult(at, cid, name, details=None):
    return {"type": "message", "timestamp": iso(at), "message": {"role": "toolResult", "toolCallId": cid, "toolName": name,
                                                              "content": [{"type": "text", "text": "SECRET_OUTPUT"}], "details": details or {}}}


def env(home, procs=None, status=None, now=NOW):
    return sa.Env(home=home, app=os.path.join(home, "app"), now=now, procs=procs or (lambda pid: []),
                  git_status=status or (lambda top: None))


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.realpath(self.tmp.name)
        self.wt = os.path.join(self.home, "repo")
        os.makedirs(self.wt)

    def tearDown(self):
        self.tmp.cleanup()


class ClaudeTest(Base):
    def claude(self, sid="S1"):
        write(os.path.join(self.home, ".claude", "sessions", "300.json"), {"sessionId": sid, "cwd": self.wt})
        self.proj = os.path.join(self.home, ".claude", "projects", "-repo")
        self.subs = os.path.join(self.proj, sid, "subagents")
        return lambda pid: [sa.Proc(100, "ttys001"), sa.Proc(300, "ttys001")] if pid == 100 else []

    def run_scan(self, procs, status=None, now=NOW):
        req = [{"address": "t1", "pid": 100, "harness": "claude", "top": self.wt}]
        return sa.scan(req, env(self.home, procs, status, now))["agents"]["t1"]

    def test_running_subagent_action_and_edits(self):
        procs = self.claude()
        f = lambda n: os.path.join(self.wt, n)
        write(os.path.join(self.subs, "agent-a1.meta.json"), {"description": "Run the tests", "agentType": "general-purpose"})
        jsonl(os.path.join(self.subs, "agent-a1.jsonl"), [
            use(NOW - 5 * MIN, "u1", "Edit", {"file_path": f("a.py"), "old_string": "x", "new_string": "SECRET_EDIT"}),
            result(NOW - 5 * MIN, "u1"),
            use(NOW - 4 * MIN, "u2", "Write", {"file_path": f("b.py"), "content": "SECRET_CONTENT"}),
            result(NOW - 4 * MIN, "u2"),
            use(NOW - 3 * MIN, "u3", "Bash", {"command": "SECRET_CMD sed -i", "description": "Rename the helper"}),
            result(NOW - 3 * MIN, "u3", {"stdout": "", "bashEditDiff": {"files": [{"filePath": f("c.py"), "hunks": []}], "changedFiles": [f("d.py")]}}),
            use(NOW - 2 * MIN, "u4", "Bash", {"command": "SECRET_CMD pytest", "description": "Run the tests"}),
        ])
        out = self.run_scan(procs, status=lambda top: " M a.py\0?? c.py\0" if top == self.wt else None)
        [s] = out["subagents"]
        self.assertEqual((s["id"], s["title"], s["running"], s["action"]), ("a1", "Run the tests", True, "Run the tests"))
        self.assertEqual([e["rel"] for e in s["edited"]], ["c.py", "d.py", "b.py", "a.py"])  # newest first
        self.assertEqual({e["rel"]: e["dirty"] for e in s["edited"]}, {"a.py": True, "b.py": False, "c.py": True, "d.py": False})
        self.assertIsNone(s["worktree"])
        text = json.dumps(out)
        for secret in ("SECRET_PROMPT", "SECRET_OUTPUT", "SECRET_EDIT", "SECRET_CONTENT", "SECRET_CMD"):
            self.assertNotIn(secret, text)  # file paths and Bash descriptions only

    def test_labels_without_description(self):
        self.assertEqual(sa.claude_label("Bash", {"command": "rm -rf SECRET"}), "Running a command")
        self.assertEqual(sa.claude_label("Read", {"file_path": "/w/x/lib.js"}), "Read lib.js")
        self.assertEqual(sa.claude_label("Edit", {"file_path": "/w/main.js"}), "Edit main.js")
        self.assertEqual(sa.claude_label("mcp__srv__do_thing", {}), "do_thing")
        self.assertEqual(sa.claude_label("Grep", {"pattern": "SECRET"}), "Search")

    def test_finished_window_and_stale(self):
        procs = self.claude()
        write(os.path.join(self.subs, "agent-done.meta.json"), {"description": "Done one", "finished": True})
        jsonl(os.path.join(self.subs, "agent-done.jsonl"), [use(NOW - 20 * MIN, "u1", "Bash", {"command": "x"})], mtime=NOW - 20 * MIN)
        write(os.path.join(self.subs, "agent-old.meta.json"), {"description": "Old one", "finished": True})
        jsonl(os.path.join(self.subs, "agent-old.jsonl"), [], mtime=NOW - 45 * MIN)
        write(os.path.join(self.subs, "agent-stale.meta.json"), {"description": "Stale one"})  # never finished, idle 12 min
        jsonl(os.path.join(self.subs, "agent-stale.jsonl"), [use(NOW - 12 * MIN, "u1", "Bash", {"command": "x"})], mtime=NOW - 12 * MIN)
        os.makedirs(os.path.join(self.subs, "workflows"))  # Claude keeps other things here
        subs = {s["id"]: s for s in self.run_scan(procs)["subagents"]}
        self.assertEqual(set(subs), {"done", "stale"})  # older than 30 min: left out
        self.assertFalse(subs["done"]["running"])
        self.assertIsNone(subs["done"]["action"])
        self.assertFalse(subs["stale"]["running"])
        self.assertEqual(subs["done"]["updatedAt"], NOW - 20 * MIN)

    def test_isolated_worktree_and_incremental_reads(self):
        procs = self.claude()
        iso_wt = os.path.join(self.home, "wt2")
        os.makedirs(iso_wt)
        write(os.path.join(self.subs, "agent-b.meta.json"), {"description": "Isolated", "worktreePath": iso_wt})
        log = os.path.join(self.subs, "agent-b.jsonl")
        jsonl(log, [use(NOW - 3 * MIN, "u1", "Edit", {"file_path": os.path.join(iso_wt, "x.py")}), result(NOW - 3 * MIN, "u1")])
        status = lambda top: " M x.py\0 M y.py\0" if top == iso_wt else None
        [s] = self.run_scan(procs, status)["subagents"]
        self.assertEqual((s["worktree"], s["action"], [e["rel"] for e in s["edited"]]), (iso_wt, None, ["x.py"]))
        # The next run reads only what was appended, and keeps what it learned before (edits, the call in flight).
        with open(log, "a") as f:
            f.write(json.dumps(use(NOW - 1 * MIN, "u2", "Edit", {"file_path": os.path.join(iso_wt, "y.py")})) + "\n")
            f.write('{"type": "assistant", "half a li')  # a line still being written waits for the next run
        os.utime(log, (NOW / 1000, NOW / 1000))
        [s] = self.run_scan(procs, status)["subagents"]
        self.assertEqual([e["rel"] for e in s["edited"]], ["y.py", "x.py"])
        self.assertEqual(s["action"], "Edit y.py")
        self.assertTrue(all(e["dirty"] for e in s["edited"]))

    def test_main_agent_recent_edits(self):
        procs = self.claude()
        jsonl(os.path.join(self.proj, "S1.jsonl"), [
            use(NOW - 50 * MIN, "u0", "Edit", {"file_path": os.path.join(self.wt, "old.py")}),
            use(NOW - 2 * MIN, "u1", "Edit", {"file_path": os.path.join(self.wt, "a.py")}),
        ])
        out = self.run_scan(procs)
        self.assertEqual([e["rel"] for e in out["edited"]], ["a.py"])  # the last 30 min only
        self.assertEqual(out["subagents"], [])

    def test_own_transcript_first_read_from_its_tail(self):
        procs = self.claude()
        log = os.path.join(self.proj, "S1.jsonl")
        jsonl(log, [use(NOW - 3 * MIN, "u0", "Edit", {"file_path": os.path.join(self.wt, "early.py")})]
              + [{"type": "attachment", "pad": "x" * 200}] * 5
              + [use(NOW - 2 * MIN, "u1", "Edit", {"file_path": os.path.join(self.wt, "late.py")})])
        tail, sa.TAIL = sa.TAIL, 400
        try:
            out = self.run_scan(procs)
        finally:
            sa.TAIL = tail
        self.assertEqual([e["rel"] for e in out["edited"]], ["late.py"])

    def test_no_session_is_empty_not_error(self):
        out = sa.scan([{"address": "t1", "pid": 5, "harness": "claude"}], env(self.home))
        self.assertEqual(out["agents"]["t1"], {"edited": [], "subagents": []})


class OmpTest(Base):
    def test_task_files_running_finished_nested(self):
        sdir = os.path.join(self.home, ".omp", "agent", "sessions", "-repo")
        session = os.path.join(sdir, "2026-11-11T23-07-55-093Z_01abc.jsonl")
        jsonl(session, [{"type": "session", "cwd": self.wt}])
        write_ptr = os.path.join(self.home, ".omp", "agent", "terminal-sessions", "ttys009")
        os.makedirs(os.path.dirname(write_ptr))
        with open(write_ptr, "w") as f:
            f.write(f"{self.wt}\n{session}\n")
        tasks = session[:-6]
        a = os.path.join(self.wt, "a.py")
        jsonl(os.path.join(tasks, "GraphPanel.jsonl"), [
            {"type": "title", "title": ""},
            {"type": "session", "cwd": self.wt},
            call(NOW - 3 * MIN, "c1", "edit", {"input": f"[{a}#44AF]\nSECRET_EDIT", "i": "Fix the edge"}),
            oresult(NOW - 3 * MIN, "c1", "edit", {"path": a}),
            call(NOW - 2 * MIN, "c2", "write", {"path": "b.py", "content": "SECRET_CONTENT", "i": "Write b"}),
            oresult(NOW - 2 * MIN, "c2", "write"),
            call(NOW - 1 * MIN, "c3", "bash", {"command": "SECRET_CMD"}),
            {"type": "custom", "customType": "tool_execution_start", "timestamp": iso(NOW - 1 * MIN),
             "data": {"toolCallId": "c3", "toolName": "bash", "intent": "Run the tests"}},
        ])
        jsonl(os.path.join(tasks, "Tests", "Tests.Unit.jsonl"), [
            {"type": "custom", "customType": "session_exit", "data": {"reason": "dispose"}}], mtime=NOW - 5 * MIN)
        jsonl(os.path.join(tasks, "__advisor.jsonl"), [])
        procs = lambda pid: [sa.Proc(7, None), sa.Proc(8, "ttys009")] if pid == 7 else []
        out = sa.scan([{"address": "t2", "pid": 7, "harness": "omp", "top": self.wt}],
                      env(self.home, procs, lambda top: "?? b.py\0"))["agents"]["t2"]
        subs = {s["id"]: s for s in out["subagents"]}
        self.assertEqual(set(subs), {"GraphPanel", "Tests/Tests.Unit"})
        g = subs["GraphPanel"]
        self.assertEqual((g["title"], g["running"], g["action"]), ("GraphPanel", True, "Run the tests"))
        self.assertEqual([(e["rel"], e["dirty"]) for e in g["edited"]], [("b.py", True), ("a.py", False)])
        self.assertFalse(subs["Tests/Tests.Unit"]["running"])
        self.assertEqual(subs["Tests/Tests.Unit"]["title"], "Tests.Unit")
        self.assertNotIn("SECRET", json.dumps(out))

    def test_omp_label(self):
        self.assertEqual(sa.omp_label("read", {"path": "/w/x.md"}, None), "Read x.md")
        self.assertEqual(sa.omp_label("bash", {"command": "SECRET"}, None), "Running a command")
        self.assertEqual(sa.omp_label("bash", {"command": "SECRET"}, "Check the build\nmore"), "Check the build")


class ProtocolTest(Base):
    def test_porcelain(self):
        self.assertEqual(sa.porcelain(" M a.py\0R  new.py\0old.py\0?? d/e.py\0"), ["a.py", "new.py", "d/e.py"])

    def test_bad_input_and_bad_files_never_crash(self):
        self.assertIn("error", sa.scan("nope", env(self.home)))
        out = sa.scan([{"address": "t1", "pid": "x", "harness": "claude"}, {"address": "t3", "harness": "codex"}], env(self.home))
        self.assertIn("error", out["agents"]["t1"])
        self.assertNotIn("t3", out["agents"])  # not a harness v1 reads

    def test_cli_always_json(self):
        r = subprocess.run([sys.executable, "-B", os.path.join(HERE, "subagents.py"), "--json", "{bad"],
                           capture_output=True, text=True, env={**os.environ, "HERDR_APP_HOME": self.home})
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout)["error"]["code"], "bad-request")


if __name__ == "__main__":
    unittest.main()
