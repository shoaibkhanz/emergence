import contextlib
import io
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


def env(home, procs=None, status=None, now=NOW, penv=None):
    return sa.Env(home=home, app=os.path.join(home, "app"), now=now, procs=procs or (lambda pid: []),
                  git_status=status or (lambda top: None), penv=penv or (lambda pid: ""))


# An assistant record as Claude Code writes it: one content block per record, the message's usage on each.
def msg(at, mid, model="claude-opus-5-5", usage=None, tool=None, sid=None, kind="assistant"):
    u = usage if usage is not None else {"input_tokens": 1_000_000}
    content = [{"type": "tool_use", "id": tool, "name": "Bash", "input": {"command": "SECRET_CMD"}}] if tool else [{"type": "text", "text": "SECRET_PROMPT"}]
    return {"type": kind, "timestamp": iso(at), **({"sessionId": sid} if sid else {}),
            "message": {"id": mid, "model": model, "usage": u, "content": content}}


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

    def test_history_and_stale(self):
        procs = self.claude()
        write(os.path.join(self.subs, "agent-done.meta.json"), {"description": "Done one", "finished": True})
        jsonl(os.path.join(self.subs, "agent-done.jsonl"), [use(NOW - 20 * MIN, "u1", "Bash", {"command": "x"})], mtime=NOW - 20 * MIN)
        write(os.path.join(self.subs, "agent-old.meta.json"), {"description": "Old one", "finished": True})
        jsonl(os.path.join(self.subs, "agent-old.jsonl"), [], mtime=NOW - 45 * MIN)
        write(os.path.join(self.subs, "agent-stale.meta.json"), {"description": "Stale one"})  # never finished, idle 12 min
        jsonl(os.path.join(self.subs, "agent-stale.jsonl"), [use(NOW - 12 * MIN, "u1", "Bash", {"command": "x"})], mtime=NOW - 12 * MIN)
        os.makedirs(os.path.join(self.subs, "workflows"))  # Claude keeps other things here
        subs = {s["id"]: s for s in self.run_scan(procs)["subagents"]}
        self.assertEqual(set(subs), {"done", "old", "stale"})  # every sub-agent the session ran, however old
        self.assertFalse(subs["done"]["running"])
        self.assertIsNone(subs["done"]["action"])
        self.assertFalse(subs["stale"]["running"])
        self.assertEqual(subs["done"]["updatedAt"], NOW - 20 * MIN)
        self.assertEqual((subs["old"]["finishedAt"], subs["stale"]["finishedAt"]), (NOW - 45 * MIN, NOW - 12 * MIN))

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
        self.assertEqual(out["agents"]["t1"], {"edited": [], "subagents": [], "tools": 0, "tokens": 0, "cost": None, "costKind": None})

    def test_metrics_dedupe_by_message_and_call(self):
        procs = self.claude()
        write(os.path.join(self.subs, "agent-m.meta.json"), {"description": "Metered"})
        jsonl(os.path.join(self.subs, "agent-m.jsonl"), [
            msg(NOW - 3 * MIN, "m1", tool="c1"),  # one message, written once per block: two calls, one cost
            msg(NOW - 3 * MIN, "m1", tool="c2"),
            msg(NOW - 3 * MIN, "m1", tool="c2"),  # the same call again: once
            msg(NOW - 2 * MIN, "m2", usage={"output_tokens": 100_000}),
            msg(NOW - 2 * MIN, "m2", usage={"output_tokens": 200_000}),  # streamed: the last usage wins
            msg(NOW - 2 * MIN, "m9", tool="c9", kind="api-request-blob"),  # repeats calls; never counted
            msg(NOW - 1 * MIN, "m3", model="<synthetic>", usage={"output_tokens": 5}),  # no request, no cost
        ])
        [s] = self.run_scan(procs)["subagents"]
        self.assertEqual((s["tools"], s["tokens"]), (2, 1_200_000))
        self.assertAlmostEqual(s["cost"], 4 + 4)  # 1M input at $4 + 200k output at $20
        self.assertEqual(s["costKind"], "estimate")
        # A repeat far down the log, read in a later run, still counts once.
        with open(os.path.join(self.subs, "agent-m.jsonl"), "a") as f:
            f.write(json.dumps(msg(NOW, "m1", tool="c1")) + "\n" + json.dumps(msg(NOW, "m4", usage={"input_tokens": 10}, tool="c4")) + "\n")
        [s] = self.run_scan(procs)["subagents"]
        self.assertEqual((s["tools"], s["tokens"]), (3, 1_200_010))

    def test_advisor_requests_count(self):
        procs = self.claude()
        write(os.path.join(self.subs, "agent-v.meta.json"), {"description": "Advised"})
        adv = {"type": "advisor_message", "model": "claude-fable-5-2", "input_tokens": 1_000_000, "output_tokens": 0}
        jsonl(os.path.join(self.subs, "agent-v.jsonl"), [msg(NOW - 1 * MIN, "m1", usage={"input_tokens": 1_000_000, "iterations": [
            {"type": "message", "input_tokens": 1_000_000}, adv]})])
        [s] = self.run_scan(procs)["subagents"]
        self.assertEqual(s["tokens"], 2_000_000)  # the executor's own iteration is the message's usage already
        self.assertAlmostEqual(s["cost"], 4 + 8)

    def test_unknown_model_shows_tokens_not_cost(self):
        procs = self.claude()
        write(os.path.join(self.subs, "agent-u.meta.json"), {"description": "Unknown"})
        jsonl(os.path.join(self.subs, "agent-u.jsonl"), [msg(NOW - 1 * MIN, "m1"), msg(NOW - 1 * MIN, "m2", model="claude-next-9")])
        [s] = self.run_scan(procs)["subagents"]
        self.assertEqual((s["tokens"], s["cost"], s["costKind"]), (2_000_000, None, None))

    def test_main_transcript_counts_its_own_session_whole(self):
        procs = self.claude()
        log = os.path.join(self.proj, "S1.jsonl")
        jsonl(log, [msg(NOW - 90 * MIN, "m0", sid="S1", tool="c0")]  # before the tail: still counted
              + [{"type": "attachment", "pad": "x" * 200}] * 5
              + [msg(NOW - 80 * MIN, "old", sid="S0", tool="c8"),  # copied in by a resume: the earlier session's
                 msg(NOW - 1 * MIN, "m1", sid="S1", usage={"output_tokens": 50_000})])
        tail, sa.TAIL = sa.TAIL, 400
        try:
            out = self.run_scan(procs)
        finally:
            sa.TAIL = tail
        self.assertEqual((out["tools"], out["tokens"]), (1, 1_050_000))
        self.assertAlmostEqual(out["cost"], 4 + 1)

    def test_billing_label_and_no_key_material(self):
        procs = self.claude()
        key = "sk-ant-api03-" + "K" * 30 + "SUFFIXSUFFIXSUFFIX20"
        write(os.path.join(self.home, ".claude.json"), {"customApiKeyResponses": {"approved": [key[-20:]], "rejected": []},
                                                        "oauthAccount": {"billingType": "stripe_subscription"}})
        jsonl(os.path.join(self.proj, "S1.jsonl"), [msg(NOW - 1 * MIN, "m1", sid="S1")])
        write(os.path.join(self.subs, "agent-a.meta.json"), {"description": "Sub"})
        jsonl(os.path.join(self.subs, "agent-a.jsonl"), [msg(NOW - 1 * MIN, "m2")])
        ps = lambda k: (lambda pid: f"/usr/bin/claude --x TERM=xterm ANTHROPIC_API_KEY={k} HOME=/h" if pid == 300 else "")
        req = [{"address": "t1", "pid": 100, "harness": "claude", "top": self.wt}]
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            api = sa.scan(req, env(self.home, procs, penv=ps(key)))
            other = sa.scan(req, env(self.home, procs, penv=ps("sk-ant-api03-not-approved-key-000000000")))["agents"]["t1"]
            none = sa.scan(req, env(self.home, procs))["agents"]["t1"]
            with open(os.path.join(self.home, ".claude.json"), "w") as f:
                f.write("{broken")
            broken = sa.scan(req, env(self.home, procs, penv=ps(key)))["agents"]["t1"]
        a = api["agents"]["t1"]
        self.assertEqual((a["costKind"], a["subagents"][0]["costKind"]), ("api", "api"))
        self.assertEqual((other["costKind"], none["costKind"], broken["costKind"]), ("estimate", "estimate", "estimate"))
        with open(sa.cache_path(env(self.home))) as f:
            cached = f.read()
        for text in (json.dumps(api), err.getvalue(), cached):
            self.assertNotIn(key[-20:], text)
            self.assertNotIn("SECRET", text)
        self.assertNotIn("ANTHROPIC", json.dumps(api))

    def test_finished_logs_cache_only_their_totals(self):
        procs = self.claude()
        write(os.path.join(self.subs, "agent-f.meta.json"), {"description": "Working"})
        jsonl(os.path.join(self.subs, "agent-f.jsonl"), [msg(NOW - 2 * MIN, "m1", tool="c1")], mtime=NOW - 2 * MIN)
        [s] = self.run_scan(procs)["subagents"]
        self.assertEqual((s["tools"], s["running"]), (1, True))
        write(os.path.join(self.subs, "agent-f.meta.json"), {"description": "Done", "finished": True})  # nothing appended
        [s] = self.run_scan(procs)["subagents"]
        self.assertEqual((s["tools"], s["running"]), (1, False))
        with open(sa.cache_path(env(self.home))) as f:
            entry = next(v for k, v in json.load(f).items() if k.endswith("agent-f.jsonl"))
        self.assertNotIn('"m1"', json.dumps(entry))  # no per-message ids kept for a log that won't grow
        [s] = self.run_scan(procs)["subagents"]  # and the next run still has its totals
        self.assertEqual(s["tools"], 1)


class DetailTest(Base):
    """One sub-agent's whole story, read when its details open: printed for the view, never cached."""
    claude = ClaudeTest.claude

    def req(self, sid="a1", harness="claude"):
        return {"pid": 100, "harness": harness, "top": self.wt, "id": sid}

    def test_task_result_facts_and_files(self):
        procs = self.claude()
        write(os.path.join(self.subs, "agent-a1.meta.json"), {"description": "Fix the flaky test", "agentType": "general-purpose", "finished": True})
        jsonl(os.path.join(self.subs, "agent-a1.jsonl"), [
            {"type": "user", "timestamp": iso(NOW - 9 * MIN), "message": {"role": "user", "content": "Fix the flaky test in a.py.\nIt fails one run in ten."}},
            {"type": "attachment", "timestamp": iso(NOW - 9 * MIN), "attachment": {"type": "reminder"}},
            {**(e := use(NOW - 8 * MIN, "u1", "Edit", {"file_path": os.path.join(self.wt, "a.py"), "old_string": "x", "new_string": "y"})),
             "message": {**e["message"], "id": "m1", "model": "claude-opus-5-5"}},  # a real record carries its message id
            result(NOW - 8 * MIN, "u1"),
            {"type": "assistant", "timestamp": iso(NOW - 7 * MIN), "message": {"id": "m9", "model": "claude-opus-5-5", "usage": {"input_tokens": 1000},
                                                                            "content": [{"type": "text", "text": "Fixed: a.py waited on a timer."}]}},
        ], mtime=NOW - 7 * MIN)
        out = sa.detail(self.req(), env(self.home, procs, lambda top: " M a.py\0" if top == self.wt else None))
        d = out["detail"]
        self.assertEqual((d["title"], d["type"], d["model"], d["running"]), ("Fix the flaky test", "general-purpose", "claude-opus-5-5", False))
        self.assertEqual(d["task"], "Fix the flaky test in a.py.\nIt fails one run in ten.")
        self.assertEqual(d["result"], "Fixed: a.py waited on a timer.")
        self.assertEqual((d["startedAt"], d["endedAt"]), (NOW - 9 * MIN, NOW - 7 * MIN))
        self.assertEqual([(e["rel"], e["dirty"]) for e in d["edited"]], [("a.py", True)])
        self.assertEqual(d["tools"], 1)
        self.assertFalse(os.path.exists(sa.cache_path(env(self.home))))  # nothing kept: prompts and output stay out of the cache

    def test_result_from_handback(self):
        procs = self.claude()
        jsonl(os.path.join(self.subs, "agent-a1.jsonl"), [
            {"type": "user", "timestamp": iso(NOW - 3 * MIN), "message": {"content": [{"type": "text", "text": "Review the diff"}]}},
            {"type": "assistant", "timestamp": iso(NOW - 2 * MIN), "message": {"content": [{"type": "text", "text": "Looking."}]}},
            use(NOW - MIN, "h1", "SubagentHandback", {"message": "## Findings\nNone."}),
            result(NOW - MIN, "h1"),
        ])
        d = sa.detail(self.req(), env(self.home, procs))["detail"]
        self.assertEqual((d["task"], d["result"]), ("Review the diff", "## Findings\nNone."))

    def test_narration_before_more_work_is_no_result(self):
        procs = self.claude()
        jsonl(os.path.join(self.subs, "agent-a1.jsonl"), [
            {"type": "user", "timestamp": iso(NOW - 2 * MIN), "message": {"content": "Run the suite"}},
            {"type": "assistant", "timestamp": iso(NOW - MIN), "message": {"content": [{"type": "text", "text": "Looking."}]}},
            use(NOW - MIN, "b1", "Bash", {"command": "pytest", "description": "Run the tests"}),
        ])
        d = sa.detail(self.req(), env(self.home, procs))["detail"]
        self.assertTrue(d["running"])
        self.assertIsNone(d["result"])  # "Looking." was on the way, not the outcome

    def steps_log(self):
        procs = self.claude()
        f = lambda n: os.path.join(self.wt, n)
        err = {"type": "user", "timestamp": iso(NOW - 3 * MIN + 5000), "message": {"content": [
            {"type": "tool_result", "tool_use_id": "u2", "is_error": True, "content": "Exit code 1\nFAILED test_a\n" + "x\n" * 60}]}}
        jsonl(os.path.join(self.subs, "agent-a1.jsonl"), [
            {"type": "user", "timestamp": iso(NOW - 5 * MIN), "message": {"content": "Fix it"}},
            use(NOW - 4 * MIN, "u1", "Read", {"file_path": f("a.py")}),
            result(NOW - 4 * MIN + 2000, "u1"),
            use(NOW - 3 * MIN, "u2", "Bash", {"command": "SECRET_CMD pytest -x", "description": "Run the tests"}),
            err,
            use(NOW - 2 * MIN, "u3", "Grep", {"pattern": "def a", "path": self.wt}),
            use(NOW - MIN, "h1", "SubagentHandback", {"message": "done"}),
        ])
        return procs

    def test_steps_light_with_outcomes_and_reads(self):
        procs = self.steps_log()
        d = sa.detail(self.req(), env(self.home, procs))["detail"]
        self.assertEqual([(x["tool"], x["label"], x["target"], x["ok"], x["ms"]) for x in d["steps"]], [
            ("Read", "Read a.py", "a.py", True, 2000), ("Bash", "Run the tests", "SECRET_CMD pytest", False, 5000), ("Grep", "Search", "def a", None, None)])
        self.assertEqual([x["call"] for x in d["steps"]], ["u1", "u2", "u3"])  # the handback is the result, not a step
        self.assertEqual(d["read"], ["a.py"])
        self.assertNotIn("-x", json.dumps(d["steps"]))  # a command's program, never its arguments: those come when it's opened

    def test_one_step_on_demand_capped(self):
        procs = self.steps_log()
        s = sa.step({**self.req(), "call": "u2"}, env(self.home, procs))["step"]
        self.assertEqual((s["input"], s["ok"]), ("SECRET_CMD pytest -x", False))
        self.assertTrue(s["output"].startswith("Exit code 1\nFAILED test_a"))
        self.assertEqual(len(s["output"].split("\n")), sa.STEP_LINES + 1)  # cut, with "…" on its own line
        self.assertEqual(sa.step({**self.req(), "call": "nope"}, env(self.home, procs))["error"]["code"], "gone")
        self.assertEqual(sa.step({**self.req(), "call": "u3"}, env(self.home, procs))["step"]["output"], None)  # still running

    def test_bash_target_is_its_program(self):
        self.assertEqual(sa.bash_target("git -C /x status --short"), "git")  # -C isn't a subcommand
        self.assertEqual(sa.bash_target("cd /w && bun test lib.test.js"), "bun test")  # a leading cd is where, not what
        self.assertEqual(sa.bash_target("cd /w"), "cd")
        self.assertEqual(sa.bash_target("ANTHROPIC_API_KEY=sk-SECRET python3 -m pytest"), "python3")
        self.assertEqual(sa.bash_target("/usr/bin/gh pr list --json x"), "gh pr")
        self.assertEqual(sa.bash_target("bun test"), "bun test")
        self.assertIsNone(sa.bash_target(""))

    def test_long_text_is_cut(self):
        procs = self.claude()
        jsonl(os.path.join(self.subs, "agent-a1.jsonl"), [{"type": "user", "timestamp": iso(NOW), "message": {"content": "x" * (sa.TEXT_MAX + 50)}}])
        d = sa.detail(self.req(), env(self.home, procs))["detail"]
        self.assertEqual(len(d["task"]), sa.TEXT_MAX + 1)
        self.assertTrue(d["task"].endswith("…"))
        self.assertIsNone(d["result"])

    def test_gone_bad_and_not_yet(self):
        procs = self.claude()
        os.makedirs(self.subs)
        self.assertEqual(sa.detail(self.req("zz"), env(self.home, procs))["error"]["code"], "gone")
        self.assertEqual(sa.detail(self.req("../x"), env(self.home, procs))["error"]["code"], "bad-request")
        self.assertEqual(sa.detail("nope", env(self.home, procs))["error"]["code"], "bad-request")
        self.assertEqual(sa.detail(self.req(harness="omp"), env(self.home, procs))["error"]["code"], "unsupported")

    def test_cli_detail_always_json(self):
        r = subprocess.run([sys.executable, "-B", os.path.join(HERE, "subagents.py"), "--detail", json.dumps(self.req())],
                           capture_output=True, text=True, env={**os.environ, "HERDR_APP_HOME": self.home, "HOME": self.home})
        self.assertEqual(r.returncode, 0)
        self.assertIn(json.loads(r.stdout)["error"]["code"], ("gone", "no-session"))


class PriceTest(unittest.TestCase):
    def test_longest_prefix_with_a_boundary(self):
        self.assertEqual(sa.price("claude-fable-5-2"), (8, 40, 0.025))
        self.assertEqual(sa.price("claude-fable-5-20261101"), (10, 50, 0.1))  # a date suffix, not fable-5-2
        self.assertEqual(sa.price("claude-opus-4-8[1m]"), (5, 25, 0.1))
        self.assertEqual(sa.price("claude-haiku-5-5@20261001"), (0.10, 0.50, 0.1))
        self.assertIsNone(sa.price("claude-opus-9"))
        self.assertIsNone(sa.price(None))

    def test_claude_cost(self):
        M = 1_000_000
        c = lambda u, m="claude-opus-5-5": sa.claude_cost(m, u)
        self.assertAlmostEqual(c({"input_tokens": M, "output_tokens": M}), 4 + 20)
        self.assertAlmostEqual(c({"cache_read_input_tokens": M}), 4 * 0.05)
        self.assertAlmostEqual(c({"cache_creation": {"ephemeral_5m_input_tokens": M, "ephemeral_1h_input_tokens": M},
                                  "cache_creation_input_tokens": 2 * M}), 4 * 1.25 + 4 * 2)  # the breakdown wins
        self.assertAlmostEqual(c({"cache_creation_input_tokens": M}), 4 * 1.25)  # no breakdown: 5-minute writes
        self.assertAlmostEqual(c({"input_tokens": M, "speed": "fast"}), 8)
        self.assertAlmostEqual(c({"input_tokens": M}, "claude-sonnet-4-6-20260101"), 3)
        self.assertIsNone(c({"input_tokens": M}, "gpt-9"))


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
        self.assertEqual((g["tools"], g["cost"], g["costKind"]), (3, None, None))  # no usage recorded: nothing to show

    def test_omp_recorded_cost(self):
        sdir = os.path.join(self.home, ".omp", "agent", "sessions", "-repo")
        session = os.path.join(sdir, "s1.jsonl")
        usage = lambda c: {"input": 10, "output": 20, "cacheRead": 30, "cacheWrite": 40, "totalTokens": 100, "cost": {"total": c}}
        turn = lambda at, c, calls: {"type": "message", "timestamp": iso(at), "message": {"role": "assistant", "usage": usage(c),
                                     "content": [{"type": "toolCall", "id": f"c{i}", "name": "read", "arguments": {}} for i in range(calls)]}}
        jsonl(session, [{"type": "session", "cwd": self.wt}, turn(NOW - 3 * MIN, 0.25, 2), turn(NOW - 2 * MIN, 0.5, 1),
                        {"type": "model_usage", "model": "x", "usage": usage(0.125)}])
        jsonl(os.path.join(session[:-6], "Task.jsonl"), [turn(NOW - 1 * MIN, 1.0, 4)])
        ptr = os.path.join(self.home, ".omp", "agent", "terminal-sessions", "ttys009")
        os.makedirs(os.path.dirname(ptr))
        with open(ptr, "w") as f:
            f.write(f"{self.wt}\n{session}\n")
        procs = lambda pid: [sa.Proc(8, "ttys009")] if pid == 7 else []
        out = sa.scan([{"address": "t2", "pid": 7, "harness": "omp", "top": self.wt}], env(self.home, procs))["agents"]["t2"]
        self.assertEqual((out["tools"], out["tokens"], out["cost"], out["costKind"]), (3, 300, 0.875, "recorded"))
        [s] = out["subagents"]
        self.assertEqual((s["tools"], s["tokens"], s["cost"], s["costKind"]), (4, 100, 1.0, "recorded"))

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
