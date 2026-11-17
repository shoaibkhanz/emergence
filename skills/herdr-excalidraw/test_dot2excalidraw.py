"""dot2excalidraw: DOT laid out by Graphviz -> Excalidraw elements that fit their text and stay bound. Needs Graphviz."""
import json, os, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dot2excalidraw as d2e  # noqa: E402

DOT = r'''digraph {
  label="Checkout";
  subgraph cluster_api { label="Backend"; api [label="API gateway\nGo"]; orders [label="Orders service"]; }
  db [label="Orders DB", shape=cylinder, style=filled, fillcolor="#b2f2bb"];
  user [label="Customer", shape=ellipse];
  ok [label="Paid?", shape=diamond];
  user -> api [label="HTTPS"];
  api -> orders;
  orders -> db [style=dashed];
  orders -> ok;
  ghost [style=invis]; user -> ghost [style=invis];
}
'''


@unittest.skipUnless(shutil.which("dot"), "needs Graphviz")
class Dot2Excalidraw(unittest.TestCase):
    def setUp(self):
        self.els = d2e.convert(DOT, prefix="t")
        self.by = {e["id"]: e for e in self.els}

    def test_every_label_fits_inside_its_box_by_the_mods_own_text_metric(self):
        texts = [e for e in self.els if e["type"] == "text" and e.get("containerId") in self.by and self.by[e["containerId"]]["type"] != "arrow"]
        self.assertEqual(len(texts), 5)
        for t in texts:
            box = self.by[t["containerId"]]
            w, h = d2e.text_size(t["text"], t["fontSize"])
            room_w, room_h = d2e.inner(box)
            self.assertLessEqual(w, room_w + 0.5, t["text"])
            self.assertLessEqual(h, room_h + 0.5, t["text"])
            self.assertIn({"id": t["id"], "type": "text"}, box["boundElements"])

    def test_shapes_frames_and_colours(self):
        types = {self.by[f"t-{k}"]["type"] for k in ["api", "user", "ok", "db"]}
        self.assertEqual(types, {"rectangle", "ellipse", "diamond"})
        self.assertEqual(self.by["t-db"]["backgroundColor"], "#b2f2bb")
        frame = self.by["t-cluster_api"]
        for k in ["api", "orders"]:  # the frame holds its boxes
            b = self.by[f"t-{k}"]
            self.assertTrue(frame["x"] <= b["x"] and b["x"] + b["width"] <= frame["x"] + frame["width"])
            self.assertTrue(frame["y"] <= b["y"] and b["y"] + b["height"] <= frame["y"] + frame["height"])
        self.assertLess(self.els.index(frame), self.els.index(self.by["t-api"]))  # frames behind boxes

    def test_arrows_are_bound_both_ends_and_keep_their_label_and_dash(self):
        arrows = [e for e in self.els if e["type"] == "arrow"]
        self.assertEqual(len(arrows), 4)  # the invisible one isn't drawn
        self.assertNotIn("t-ghost", self.by)
        for a in arrows:
            for end in ["startBinding", "endBinding"]:
                box = self.by[a[end]["elementId"]]
                self.assertIn({"id": a["id"], "type": "arrow"}, box["boundElements"])
            self.assertEqual(a["points"][0], [0, 0])
        dashed = [a for a in arrows if a["strokeStyle"] == "dashed"]
        self.assertEqual([a["endBinding"]["elementId"] for a in dashed], ["t-db"])
        label = next(e for e in self.els if e["type"] == "text" and e["text"] == "HTTPS")
        self.assertEqual(self.by[label["containerId"]]["type"], "arrow")

    def test_into_an_open_drawing_goes_beside_what_is_there_and_keeps_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "d.excalidraw")
            mine = {"id": "mine", "type": "rectangle", "x": 0, "y": 0, "width": 300, "height": 200}
            with open(path, "w") as f:
                json.dump({"type": "excalidraw", "elements": [mine], "appState": {"viewBackgroundColor": "#ffffff"}, "files": {}}, f)
            subprocess.run([sys.executable, os.path.join(HERE, "dot2excalidraw.py"), "--into", path], input=DOT, text=True, check=True)
            with open(path) as f:
                doc = json.load(f)
            self.assertEqual(doc["elements"][0], mine)
            added = doc["elements"][1:]
            self.assertTrue(added)
            self.assertGreaterEqual(min(e["x"] for e in added), 300)
            ids = [e["id"] for e in doc["elements"]]
            self.assertEqual(len(ids), len(set(ids)))


@unittest.skipUnless(shutil.which("dot") and shutil.which("git"), "needs Graphviz and git")
class RepoTag(unittest.TestCase):
    def test_a_drawing_made_in_a_repo_is_filed_under_it_as_a_home_relative_path(self):
        with tempfile.TemporaryDirectory(dir=os.path.expanduser("~")) as repo:
            subprocess.run(["git", "init", "-q", repo], check=True)
            out = os.path.join(repo, "d.excalidraw")
            subprocess.run([sys.executable, os.path.join(HERE, "dot2excalidraw.py"), "-o", out], input=DOT, text=True, check=True, cwd=repo)
            with open(out) as f:
                tag = json.load(f)["appState"]["herdr_repos"]
            self.assertEqual(tag, "~" + os.path.realpath(repo)[len(os.path.realpath(os.path.expanduser("~"))):])
            subprocess.run([sys.executable, os.path.join(HERE, "dot2excalidraw.py"), "--into", out], input=DOT, text=True, check=True, cwd=repo)
            with open(out) as f:
                self.assertEqual(json.load(f)["appState"]["herdr_repos"], tag)  # once, not twice


if __name__ == "__main__":
    unittest.main()
