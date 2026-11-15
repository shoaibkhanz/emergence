import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import host  # noqa: E402
import side  # noqa: E402
from adapters import ADAPTERS  # noqa: E402

PS = """  100     1 ttys003  -zsh
  200   100 ttys003  sh -c claude
  300   200 ttys003  /x/claude --model opus
  400     1 ??       unrelated
"""


def env(home="/nonexistent", run=None, procs=None):
    return side.Env(home=home, run=run or (lambda argv: (1, "")), procs=procs or (lambda pid: []))


class ProtocolTest(unittest.TestCase):
    def test_error_shape(self):
        r = side.handle("nope", {}, env())
        self.assertEqual(r["v"], 1)
        self.assertEqual(r["error"]["code"], "unknown-op")
        self.assertTrue(r["error"]["message"])
        self.assertEqual(side.handle("locate", {"harness": "zzz"}, env())["error"]["code"], "unknown-harness")

    def test_caps_shape(self):
        for k in ADAPTERS:
            c = side.handle("caps", {"harness": k}, env())
            self.assertEqual(c["v"], 1)
            self.assertIn(c["locate"], ("exact", "guess"))
            self.assertIsInstance(c["full"], bool)
            self.assertIsNone(c["before"])
            self.assertIn(c["answerOnly"], ("enforced", "instruction", None))

    def test_cli_roundtrip(self):
        out = subprocess.run([sys.executable, os.path.join(HERE, "side.py"), "caps", "--json", '{"harness":"claude"}'],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0)
        self.assertEqual(json.loads(out.stdout)["v"], 1)

    def test_procs_tree(self):
        tree = side.procs_from(PS, 100)
        self.assertEqual([p.pid for p in tree], [100, 200, 300])
        self.assertEqual(tree[2].args, ["/x/claude", "--model", "opus"])
        self.assertEqual(tree[0].tty, "ttys003")

    def test_exception_becomes_error(self):
        def boom(argv):
            raise RuntimeError("kaboom")
        orig = ADAPTERS["claude"].caps
        ADAPTERS["claude"].caps = lambda: boom([])
        try:
            r = side.handle("caps", {"harness": "claude"}, env())
        finally:
            ADAPTERS["claude"].caps = orig
        self.assertEqual(r["error"]["code"], "internal")
        self.assertIn("kaboom", r["error"]["message"])


INSTR = "Answer and explain; don't edit files. Files may have changed since this point."
FIX = os.path.join(HERE, "fixtures")


def claude_home(tmp, pid, transcript=True):
    """A home whose ~/.claude/sessions/<pid>.json is the 2.1.325 fixture, and (unless a fresh claude that hasn't been
    asked anything yet) its transcript under ~/.claude/projects/."""
    d = os.path.join(tmp, ".claude", "sessions")
    os.makedirs(d)
    with open(os.path.join(FIX, "claude", "2.1.325", "sessions", "4242.json")) as f:
        data = json.load(f)
    with open(os.path.join(d, f"{pid}.json"), "w") as f:
        json.dump({**data, "pid": pid}, f)
    if transcript:
        proj = os.path.join(tmp, ".claude", "projects", "-w-margo")
        os.makedirs(proj)
        open(os.path.join(proj, f"{data['sessionId']}.jsonl"), "w").close()
    return tmp


BIN = sys.executable  # an absolute program path that exists, standing in for claude
TREE = [side.Proc(100, ["-zsh"], "ttys003"), side.Proc(200, ["sh", "-c", "claude"], "ttys003"),
        side.Proc(300, [BIN, "--model", "opus", "--dangerously-skip-permissions", "-c"], "ttys003")]


class ClaudeTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()

    def test_locate_walks_children(self):
        e = env(home=claude_home(self.tmp, 300), procs=lambda pid: TREE)
        r = side.handle("locate", {"harness": "claude", "pid": 100, "cwd": "/w/margo"}, e)
        self.assertEqual(r["session"], {"harness": "claude", "id": "11111111-2222-3333-4444-555555555555",
                                        "cwd": "/w/margo"})
        self.assertEqual(r["confidence"], "exact")

    def test_locate_fresh_claude_without_transcript(self):
        # a claude writes sessions/<pid>.json at start but its transcript only at the first prompt: nothing to copy yet
        e = env(home=claude_home(self.tmp, 300, transcript=False), procs=lambda pid: TREE)
        r = side.handle("locate", {"harness": "claude", "pid": 100, "cwd": "/w/margo"}, e)
        self.assertEqual(r["error"]["code"], "not-found")

    def test_locate_no_session_file(self):
        e = env(home=self.tmp, procs=lambda pid: TREE)
        r = side.handle("locate", {"harness": "claude", "pid": 100, "cwd": "/w/margo"}, e)
        self.assertEqual(r["error"]["code"], "not-found")

    def copy(self, answer_only):
        e = env(home=claude_home(self.tmp, 300), procs=lambda pid: TREE)
        session = {"harness": "claude", "id": "11111111-2222-3333-4444-555555555555", "cwd": "/w/margo"}
        return side.handle("copy", {"session": session, "pid": 100, "answerOnly": answer_only}, e)

    def test_copy_full_answer_only(self):
        r = self.copy(True)
        self.assertEqual(r["launch"]["argv"], [BIN, "--resume", "11111111-2222-3333-4444-555555555555",
                                               "--fork-session", "--model", "opus", "--permission-mode", "plan",
                                               "--append-system-prompt", INSTR])
        self.assertEqual(r["launch"]["cwd"], "/w/margo")

    def test_copy_full_not_answer_only(self):
        argv = self.copy(False)["launch"]["argv"]
        self.assertNotIn("--permission-mode", argv)
        self.assertNotIn("--dangerously-skip-permissions", argv)
        self.assertNotIn("-c", argv)
        self.assertEqual(argv, [BIN, "--resume", "11111111-2222-3333-4444-555555555555", "--fork-session",
                                "--model", "opus"])

    def test_copy_carries_equals_form(self):
        tree = TREE[:2] + [side.Proc(300, ["claude", "--effort=high", "--settings", "x.json"], "ttys003")]
        e = env(home=claude_home(self.tmp, 300), procs=lambda pid: tree)
        session = {"harness": "claude", "id": "s", "cwd": "/w"}
        argv = side.handle("copy", {"session": session, "pid": 100, "answerOnly": False}, e)["launch"]["argv"]
        self.assertEqual(argv, ["claude", "--resume", "s", "--fork-session", "--effort=high"])

    def test_copy_spaced_path_falls_back(self):
        # ps splits "/Users/x/Library/Application Support/Claude/claude" on its space: not a program to run
        tree = TREE[:2] + [side.Proc(300, ["/no/such/Application", "Support/Claude/claude", "--model", "opus"])]
        e = env(home=claude_home(self.tmp, 300), procs=lambda pid: tree)
        session = {"harness": "claude", "id": "s", "cwd": "/w"}
        argv = side.handle("copy", {"session": session, "pid": 100, "answerOnly": False}, e)["launch"]["argv"]
        self.assertEqual(argv[:4], ["claude", "--resume", "s", "--fork-session"])


OC = os.path.join(FIX, "opencode", "2.3.0")


def oc_fixture(name):
    with open(os.path.join(OC, name)) as f:
        return f.read()


OC_TREE = [side.Proc(100, ["-zsh"], "ttys004"), side.Proc(200, ["opencode"], "ttys004")]
OC_DIR = "/w/fastapi"


class OpenCodeTest(unittest.TestCase):
    def test_locate_exact_from_args(self):
        calls = []
        tree = [OC_TREE[0], side.Proc(200, ["opencode", "-s", "ses_abc"], "ttys004")]
        e = env(procs=lambda pid: tree, run=lambda argv: calls.append(argv) or (1, ""))
        r = side.handle("locate", {"harness": "opencode", "pid": 100, "cwd": OC_DIR}, e)
        self.assertEqual(r["session"], {"harness": "opencode", "id": "ses_abc", "cwd": OC_DIR})
        self.assertEqual(r["confidence"], "exact")
        self.assertEqual(calls, [])

    def test_locate_guess_newest(self):
        listed = json.loads(oc_fixture("session_list.json"))
        listed["data"].reverse()  # newest by time, not by position
        calls = []
        e = env(procs=lambda pid: OC_TREE, run=lambda argv: calls.append(argv) or (0, json.dumps(listed)))
        r = side.handle("locate", {"harness": "opencode", "pid": 100, "cwd": OC_DIR}, e)
        # the two newest rows are copies (their "fork" is set; a side chat makes those): the newest original wins
        self.assertEqual(r["session"]["id"], "ses_4984b977affeYyauIS5ge2WHJ8")
        self.assertEqual(r["confidence"], "guess")
        self.assertEqual(calls, [["opencode", "api", "session.list", "--param", f"directory={OC_DIR}"]])

    def test_locate_no_sessions(self):
        e = env(procs=lambda pid: OC_TREE, run=lambda argv: (0, json.dumps({"data": [], "cursor": {}})))
        r = side.handle("locate", {"harness": "opencode", "pid": 100, "cwd": OC_DIR}, e)
        self.assertEqual(r["error"]["code"], "not-found")

    def test_copy_forks_then_opens(self):
        calls = []
        e = env(run=lambda argv: calls.append(argv) or (0, oc_fixture("session_fork.json")))
        session = {"harness": "opencode", "id": "ses_4a04ddc87ffeQf2Y1N6phGn5ee", "cwd": OC_DIR}
        r = side.handle("copy", {"session": session, "pid": 100, "answerOnly": True}, e)
        self.assertEqual(calls, [["opencode", "api", "session.fork", "--param",
                                  "sessionID=ses_4a04ddc87ffeQf2Y1N6phGn5ee", "-d", "{}"]])
        # answer-only: OpenCode's read-only plan agent, which only `opencode mini` can be started with
        self.assertEqual(r["launch"], {"argv": ["opencode", "mini", "--agent", "plan", "-s", "ses_e214046b1ffe3mxz4AIx9i2lpk"],
                                       "cwd": OC_DIR})
        self.assertIsNone(r["note"])

    def test_copy_not_answer_only_can_edit(self):
        e = env(run=lambda argv: (0, oc_fixture("session_fork.json")))
        session = {"harness": "opencode", "id": "ses_4a04ddc87ffeQf2Y1N6phGn5ee", "cwd": OC_DIR}
        r = side.handle("copy", {"session": session, "pid": 100, "answerOnly": False}, e)
        self.assertEqual(r["launch"]["argv"], ["opencode", "-s", "ses_e214046b1ffe3mxz4AIx9i2lpk"])
        self.assertEqual(r["note"], "can-edit")
        self.assertEqual(side.handle("caps", {"harness": "opencode"}, e)["answerOnly"], "enforced")

    def test_locate_only_copies_left(self):
        listed = {"data": [r for r in json.loads(oc_fixture("session_list.json"))["data"] if r.get("fork")], "cursor": {}}
        e = env(procs=lambda pid: OC_TREE, run=lambda argv: (0, json.dumps(listed)))
        r = side.handle("locate", {"harness": "opencode", "pid": 100, "cwd": OC_DIR}, e)
        self.assertEqual(r["session"]["id"], "ses_e216a49d7ffeg0NDXLBEctOR0x")  # better a copy than nothing

    def test_copy_fork_fails(self):
        body = json.loads(oc_fixture("session_fork_400.json"))  # what the API answers without a body
        e = env(run=lambda argv: (1, f"HTTP 400 Bad Request {body['message']}"))
        session = {"harness": "opencode", "id": "ses_x", "cwd": OC_DIR}
        r = side.handle("copy", {"session": session, "pid": 100, "answerOnly": True}, e)
        self.assertEqual(r["error"]["code"], "copy-failed")
        self.assertIn("HTTP 400", r["error"]["message"])


class HostTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.dir = tempfile.mkdtemp()

    def test_send_then_take(self):
        host.send("side-2", self.dir, {"argv": ["claude", "--resume", "x"], "cwd": "/w"})
        req_path, _ = host.paths("side-2", self.dir)
        self.assertEqual(host.take(req_path), {"argv": ["claude", "--resume", "x"], "cwd": "/w"})
        self.assertIsNone(host.take(req_path))  # taken once
        self.assertEqual([f for f in os.listdir(self.dir) if f.endswith(".tmp")], [])

    def test_stale_request_is_dropped(self):
        # a request no host picked up (a host that wasn't running): never start an old chat later
        host.send("side-1", self.dir, {"argv": ["claude"], "cwd": "/w"})
        req_path, _ = host.paths("side-1", self.dir)
        old = os.path.getmtime(req_path) - host.STALE_S - 1
        os.utime(req_path, (old, old))
        self.assertIsNone(host.take(req_path))
        self.assertFalse(os.path.exists(req_path))

    def test_corrupt_request_is_dropped(self):
        req_path, _ = host.paths("side-1", self.dir)
        with open(req_path, "w") as f:
            f.write("{nope")
        self.assertIsNone(host.take(req_path))
        self.assertFalse(os.path.exists(req_path))

    def test_run_finishes(self):
        _, stop_path = host.paths("side-1", self.dir)
        self.assertEqual(host.run({"argv": ["true"], "cwd": self.dir}, stop_path, poll=0.05), 0)

    def test_stop_ends_the_chat_not_the_host(self):
        import time
        _, stop_path = host.paths("side-1", self.dir)
        host.stop("side-1", self.dir)
        t = time.time()
        host.run({"argv": ["sleep", "30"], "cwd": self.dir}, stop_path, poll=0.05)
        self.assertLess(time.time() - t, 5)
        self.assertFalse(os.path.exists(stop_path))


if __name__ == "__main__":
    unittest.main()
