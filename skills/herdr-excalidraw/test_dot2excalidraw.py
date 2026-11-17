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

    def test_frames_leave_room_around_their_boxes_and_under_their_title(self):
        frame, title = self.by["t-cluster_api"], self.by["t-cluster_api-title"]
        for k in ["api", "orders"]:
            b = self.by[f"t-{k}"]
            self.assertGreaterEqual(b["x"] - frame["x"], d2e.FRAME_ROOM - 0.5)
            self.assertGreaterEqual(frame["x"] + frame["width"] - (b["x"] + b["width"]), d2e.FRAME_ROOM - 0.5)
            self.assertGreaterEqual(frame["y"] + frame["height"] - (b["y"] + b["height"]), d2e.FRAME_ROOM - 0.5)
            self.assertGreaterEqual(b["y"] - (title["y"] + title["height"]), 8)  # the title sits clear above the boxes

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
        self.assertIsNone(label["containerId"])  # beside its arrow, not on it
        arrow = next(a for a in arrows if a["startBinding"]["elementId"] == "t-user")
        self.assertEqual(label["groupIds"], arrow["groupIds"])  # they move together
        self.assertTrue(arrow["groupIds"])

    def test_the_converters_drawing_passes_the_check_nothing_overlaps(self):
        self.assertEqual(d2e.problems(self.els), [])
        busy = r'''digraph { rankdir=LR; a -> b [label="first"]; a -> c [label="second one"]; b -> d [label="third"];
          c -> d [label="fourth label"]; a -> d [label="across", constraint=false]; d -> a [label="back again", constraint=false]; }'''
        self.assertEqual(d2e.problems(d2e.convert(busy, prefix="b")), [])  # labels Graphviz put on another arrow are moved clear

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


class Check(unittest.TestCase):
    """--check: what the skill's last step runs on a drawing, by hand or converted."""

    def box(self, id_, x, y, w=100, h=50, type_="rectangle"):
        return {"id": id_, "type": type_, "x": x, "y": y, "width": w, "height": h}

    def test_overlapping_shapes_an_arrow_through_a_shape_and_words_on_an_arrow_are_problems(self):
        a, b, c = self.box("a", 0, 0), self.box("b", 60, 20), self.box("c", 400, 0)
        wall = self.box("wall", 200, -20, 40, 120)
        arrow = {"id": "ar", "type": "arrow", "x": 100, "y": 25, "points": [[0, 0], [300, 0]], "width": 300, "height": 0,
                 "startBinding": {"elementId": "a"}, "endBinding": {"elementId": "c"}}
        words = {"id": "w", "type": "text", "x": 280, "y": 15, "width": 60, "height": 20, "text": "calls", "containerId": None}
        found = d2e.problems([a, b, c, wall, arrow, words])
        self.assertTrue(any("a" in p and "b" in p and "overlap" in p for p in found), found)
        self.assertTrue(any("ar" in p and "wall" in p for p in found), found)
        self.assertTrue(any("calls" in p and "ar" in p for p in found), found)

    def test_a_frame_holding_boxes_words_in_their_box_and_arrows_ending_at_their_boxes_are_fine(self):
        frame, a, c = self.box("f", -20, -20, 200, 120), self.box("a", 0, 0), self.box("c", 400, 0)
        inside = {"id": "t", "type": "text", "x": 10, "y": 10, "width": 40, "height": 20, "text": "API", "containerId": "a"}
        title = {"id": "ft", "type": "text", "x": -10, "y": -18, "width": 40, "height": 14, "text": "Backend", "containerId": None}
        arrow = {"id": "ar", "type": "arrow", "x": 100, "y": 25, "points": [[0, 0], [300, 0]], "width": 300, "height": 0,
                 "startBinding": {"elementId": "a"}, "endBinding": {"elementId": "c"}}
        self.assertEqual(d2e.problems([frame, a, c, inside, title, arrow]), [])


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
