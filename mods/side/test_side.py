import json
import os
import shutil
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
TRANSCRIPT = os.path.join(FIX, "claude", "2.1.325", "transcript.jsonl")
claude = ADAPTERS["claude"]


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
        shutil.copy(TRANSCRIPT, os.path.join(proj, f"{data['sessionId']}.jsonl"))
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
        return side.handle("copy", {"session": session, "pid": 100, "answerOnly": answer_only,
                                    "dataDir": os.path.join(self.tmp, "data")}, e)

    def test_render_skips_noise(self):
        with open(TRANSCRIPT) as f:
            es, summary = claude.entries(f)
        texts = " ".join(t for _, t in es)
        self.assertNotIn("thinking", texts)
        for noise in ("<command-name>", "META", "SIDECHAIN", "TOOL_RESULT", "SUMMARY"):
            self.assertNotIn(noise, texts)
        self.assertIn(("agent", "[used Read]"), es)
        self.assertEqual(es[0], ("user", "FIRST QUESTION about margo"))
        self.assertEqual(es[-1], ("agent", "LAST ANSWER"))
        self.assertEqual(summary, "SUMMARY of earlier work")

    def test_recent_cuts_at_user(self):
        es = [("user", "a" * 10), ("agent", "b" * 10), ("user", "c" * 10), ("agent", "d" * 10)]
        self.assertEqual(claude.recent(es, cap=25), es[2:])

    def test_background_one_huge_exchange(self):
        es = [("user", "q"), ("agent", "x" * 100)]
        self.assertEqual(claude.recent(es, cap=30), [("agent", "x" * 30)])

    def test_copy_fresh_answer_only(self):
        r = self.copy(True)
        argv = r["launch"]["argv"]
        self.assertEqual(argv[:4], [BIN, "--permission-mode", "plan", "--append-system-prompt-file"])
        self.assertEqual(argv[5:], ["--model", "opus"])
        self.assertNotIn("--resume", argv)
        self.assertNotIn("--fork-session", argv)
        self.assertEqual(r["launch"]["cwd"], "/w/margo")
        with open(argv[4]) as f:
            bg = f.read()
        conv = os.path.join(os.path.dirname(argv[4]), "conversation.md")
        self.assertIn(INSTR, bg)
        self.assertIn("SUMMARY of earlier work", bg)
        self.assertIn(conv, bg)
        self.assertIn("LAST QUESTION", bg)
        with open(conv) as f:
            self.assertIn("FIRST QUESTION about margo", f.read())

    def test_background_mid_work_keeps_the_question(self):
        # pressed mid-work: the last entry is a tool marker and no user-start tail fits; keep as much as fits instead
        es = [("user", "the question"), ("agent", "x" * 100), ("agent", "[used Bash]")]
        r = claude.recent(es, cap=50)
        self.assertEqual(r[-1], ("agent", "[used Bash]"))
        self.assertEqual(sum(len(t) for _, t in r), 50)
        self.assertGreater(len(r), 1)

    def test_chat_files_private(self):
        argv = self.copy(True)["launch"]["argv"]
        d = os.path.dirname(argv[4])
        self.assertEqual(os.stat(d).st_mode & 0o777, 0o700)
        for f in ("background.md", "conversation.md"):
            self.assertEqual(os.stat(os.path.join(d, f)).st_mode & 0o777, 0o600)

    def test_copy_fresh_not_answer_only(self):
        r = self.copy(False)
        self.assertEqual(r["launch"]["argv"][1], "--append-system-prompt-file")
        self.assertNotIn("--permission-mode", r["launch"]["argv"])
        self.assertEqual(r["note"], "can-edit")

    def test_old_chats_trimmed(self):
        for i in range(25):
            os.makedirs(os.path.join(self.tmp, "data", "chats", f"{1000 + i}-old"))
        self.copy(True)
        self.assertEqual(len(os.listdir(os.path.join(self.tmp, "data", "chats"))), 20)

    def fresh(self, tree):
        e = env(home=claude_home(self.tmp, 300), procs=lambda pid: tree)
        session = {"harness": "claude", "id": "11111111-2222-3333-4444-555555555555", "cwd": "/w"}
        return side.handle("copy", {"session": session, "pid": 100, "answerOnly": False,
                                    "dataDir": os.path.join(self.tmp, "data")}, e)["launch"]["argv"]

    def test_copy_carries_equals_form(self):
        argv = self.fresh(TREE[:2] + [side.Proc(300, ["claude", "--effort=high", "--settings", "x.json"], "ttys003")])
        self.assertEqual([argv[0], argv[1], argv[3:]], ["claude", "--append-system-prompt-file", ["--effort=high"]])

    def test_copy_spaced_path_falls_back(self):
        # ps splits "/Users/x/Library/Application Support/Claude/claude" on its space: not a program to run
        argv = self.fresh(TREE[:2] + [side.Proc(300, ["/no/such/Application", "Support/Claude/claude", "--model", "opus"])])
        self.assertEqual(argv[:2], ["claude", "--append-system-prompt-file"])

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
        self.assertEqual(r["launch"], {"argv": ["opencode", "mini", "--agent", "plan", "-s", "ses_e214046b1ffe3mxz4AIx9i2lpk", "--no-replay"],
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


PI_FIX = os.path.join(FIX, "pi-format", "session.jsonl")
PI_SID = "01a1e1d5-0000-0000-0000-000000000001"
PI_NAME = f"2026-11-16T00-49-57-417Z_{PI_SID}.jsonl"


class PiFormatTest(unittest.TestCase):
    def test_entries_follow_the_active_branch(self):
        from adapters import pi_format
        with open(PI_FIX) as f:
            es, summary = pi_format.entries(f)
        self.assertEqual(es, [("user", "FIRST QUESTION about pi"), ("agent", "first answer"), ("agent", "[used read]"),
                              ("user", "LAST QUESTION"), ("agent", "LAST ANSWER")])
        self.assertEqual(summary, "SUMMARY of earlier work")

    def test_model_flags_both_formats(self):
        from adapters import pi_format
        omp = ['{"type":"model_change","id":"m","parentId":null,"model":"openai/gpt-5.5"}']
        self.assertEqual(pi_format.model_flags(omp), ["--model", "openai/gpt-5.5"])
        with open(PI_FIX) as f:
            self.assertEqual(pi_format.model_flags(f), ["--model", "anthropic/claude-opus-5-5", "--thinking", "high"])

    def test_entries_empty_file(self):
        from adapters import pi_format
        self.assertEqual(pi_format.entries([]), ([], None))


def pi_home(tmp, cwd="/w/pi"):
    d = os.path.join(tmp, ".pi", "agent", "sessions", "--" + cwd.strip("/").replace("/", "-") + "--")
    os.makedirs(d)
    shutil.copy(PI_FIX, os.path.join(d, PI_NAME))
    return d


PI_TREE = [side.Proc(100, ["-zsh"], "ttys005"),
           side.Proc(200, ["node", "/opt/homebrew/bin/pi", "--model", "sonnet", "--tools", "bash", "--thinking=high"], "ttys005")]


class PiTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()

    def locate(self, tree=PI_TREE, cwd="/w/pi"):
        return side.handle("locate", {"harness": "pi", "pid": 100, "cwd": cwd}, env(home=self.tmp, procs=lambda pid: tree))

    def test_locate_guess_newest_in_folder(self):
        d = pi_home(self.tmp)
        old = os.path.join(d, "2026-01-01T00-00-00-000Z_old.jsonl")
        shutil.copy(PI_FIX, old)
        os.utime(old, (1, 1))
        r = self.locate()
        self.assertEqual(r["session"], {"harness": "pi", "id": PI_SID, "file": os.path.join(d, PI_NAME), "cwd": "/w/pi"})
        self.assertEqual(r["confidence"], "guess")

    def test_locate_exact_from_session_arg(self):
        d = pi_home(self.tmp)
        os.utime(os.path.join(d, PI_NAME), (1, 1))
        shutil.copy(PI_FIX, os.path.join(d, "2026-12-01T00-00-00-000Z_newer.jsonl"))
        tree = PI_TREE[:1] + [side.Proc(200, ["pi", "--session", PI_SID[:8]], "ttys005")]
        r = self.locate(tree)
        self.assertEqual((r["session"]["file"], r["confidence"]), (os.path.join(d, PI_NAME), "exact"))

    def test_locate_nothing_in_folder(self):
        self.assertEqual(self.locate()["error"]["code"], "not-found")

    def copy(self, answer_only, file=None):
        d = pi_home(self.tmp)
        session = {"harness": "pi", "id": PI_SID, "file": file or os.path.join(d, PI_NAME), "cwd": "/w/pi"}
        return side.handle("copy", {"session": session, "pid": 100, "answerOnly": answer_only,
                                    "dataDir": os.path.join(self.tmp, "data")}, env(home=self.tmp, procs=lambda pid: PI_TREE))

    def test_copy_answer_only(self):
        r = self.copy(True)
        argv = r["launch"]["argv"]
        # --no-session: a side chat saves nothing, so it's never the folder's newest session (pi's locate guess)
        self.assertEqual(argv[:3], ["pi", "--no-session", "--append-system-prompt"])
        # the model from the session: a running pi shows only "pi" in ps (process.title), never its flags
        self.assertEqual(argv[4:], ["--tools", "read,grep,find,ls", "--model", "anthropic/claude-opus-5-5", "--thinking", "high"])
        self.assertEqual((r["launch"]["cwd"], r["note"]), ("/w/pi", None))
        with open(argv[3]) as f:
            bg = f.read()
        for want in (INSTR, "SUMMARY of earlier work", "LAST QUESTION"):
            self.assertIn(want, bg)
        self.assertNotIn("ABANDONED", bg)

    def test_copy_not_answer_only_can_edit(self):
        r = self.copy(False)
        self.assertNotIn("--tools", r["launch"]["argv"])
        self.assertIn("--no-session", r["launch"]["argv"])
        self.assertEqual(r["note"], "can-edit")

    def test_copy_session_file_gone(self):
        self.assertEqual(self.copy(True, file=os.path.join(self.tmp, "gone.jsonl"))["error"]["code"], "not-found")


OMP_TREE = [side.Proc(100, ["-zsh"], "ttys009"), side.Proc(200, ["omp", "--model", "opus", "--profile", "work"], "ttys009")]


class OmpTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()
        self.file = os.path.join(self.tmp, PI_NAME)
        shutil.copy(PI_FIX, self.file)

    def pointer(self, tty, file):
        d = os.path.join(self.tmp, ".omp", "agent", "terminal-sessions")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, tty), "w") as f:
            f.write(f"/w/pi\n{file}\ncwdstat 1 2\n")

    def locate(self):
        return side.handle("locate", {"harness": "omp", "pid": 100, "cwd": "/w/pi"},
                           env(home=self.tmp, procs=lambda pid: OMP_TREE))

    def test_locate_exact_from_terminal_pointer(self):
        self.pointer("ttys009", self.file)
        r = self.locate()
        self.assertEqual(r["session"], {"harness": "omp", "id": PI_SID, "file": self.file, "cwd": "/w/pi"})
        self.assertEqual(r["confidence"], "exact")

    def test_locate_pointer_to_missing_file(self):
        self.pointer("ttys009", os.path.join(self.tmp, "gone.jsonl"))
        self.assertEqual(self.locate()["error"]["code"], "not-found")

    def test_locate_no_pointer(self):
        self.assertEqual(self.locate()["error"]["code"], "not-found")

    def test_copy_answer_only(self):
        session = {"harness": "omp", "id": PI_SID, "file": self.file, "cwd": "/w/pi"}
        r = side.handle("copy", {"session": session, "pid": 100, "answerOnly": True, "dataDir": os.path.join(self.tmp, "d")},
                        env(home=self.tmp, procs=lambda pid: OMP_TREE))
        argv = r["launch"]["argv"]
        # --no-session also keeps omp's autoResume from opening the agent's own file. omp adds write back to any
        # --tools list (18.20.2): always-ask makes it wait for the person's yes
        self.assertEqual(argv[:3], ["omp", "--no-session", "--append-system-prompt"])
        # no find: omp 18.20.3 refuses to start when its judge model is missing ("Built-in tool unavailable")
        self.assertEqual(argv[4:], ["--tools", "read,grep,glob", "--approval-mode", "always-ask",
                                    "--model", "anthropic/claude-opus-5-5", "--thinking", "high", "--profile", "work"])


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

    def test_run_prints_intro_first(self):
        import contextlib
        import io
        _, stop_path = host.paths("side-1", self.dir)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            host.run({"argv": ["true"], "cwd": self.dir, "intro": "INTRO LINE"}, stop_path, poll=0.05)
        self.assertIn("INTRO LINE", out.getvalue())

    def test_a_chat_that_fails_at_once_keeps_its_error_on_screen(self):
        # omp 18.20.3 refused a tool and exited 2 at once; the slot cleared its message and sat on "Opening a side chat…"
        self.assertTrue(host.failed_at_once(2, 0.4))
        self.assertFalse(host.failed_at_once(0, 0.4))  # /exit at once is still an ending
        self.assertFalse(host.failed_at_once(1, 120))  # a chat that ran a while: its error isn't why it never opened

    def test_idle_screen_says_opening(self):
        # an idle slot is only ever seen at a key press, before its chat starts
        self.assertIn("Opening a side chat", host.OPENING)
        self.assertFalse(hasattr(host, "ENDED"))

    def test_broken_code_is_not_ready(self):
        # a half-saved host.py must never replace a running host (it would exit, and Herdr would delete its block)
        good, bad = os.path.join(self.dir, "good.py"), os.path.join(self.dir, "bad.py")
        with open(good, "w") as f:
            f.write("x = 1\n")
        with open(bad, "w") as f:
            f.write("def (:\n")
        self.assertTrue(host.ready(good))
        self.assertFalse(host.ready(bad))
        self.assertFalse(host.ready(os.path.join(self.dir, "gone.py")))

    def test_changed_code_is_noticed(self):
        # an updated host.py restarts the host in place (exec: same terminal, never finished)
        f = os.path.join(self.dir, "host.py")
        open(f, "w").close()
        since = os.path.getmtime(f)
        self.assertFalse(host.changed(f, since))
        os.utime(f, (since + 5, since + 5))
        self.assertTrue(host.changed(f, since))
        self.assertFalse(host.changed(os.path.join(self.dir, "gone.py"), since))


if __name__ == "__main__":
    unittest.main()
