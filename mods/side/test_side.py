import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
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


if __name__ == "__main__":
    unittest.main()
