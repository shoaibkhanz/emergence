#!/usr/bin/env python3
"""DOT -> Excalidraw, laid out by Graphviz, for Herdr's Excalidraw panel.

Every box is sized for its label with the panel's own text metric, then handed to Graphviz as a fixed size, so
Graphviz only places boxes and routes arrows, and text never spills out. Clusters become frames, edges become arrows
bound to their boxes (they follow when a box is dragged), labels are bound text. Colours are written for a white
canvas; the panel shows them as Excalidraw's dark mode does in a dark theme.

  dot2excalidraw.py diagram.dot -o drawing.excalidraw    a new drawing
  dot2excalidraw.py diagram.dot --into drawing.excalidraw    add beside what's in an existing drawing
  ... --open    and show it in the panel (writes <herdr-app home>/data/excalidraw/open.json)
DOT comes from the file named, else stdin.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import string
import subprocess
import sys
import time

FONT, ARROW_FONT, TITLE_FONT, LINE = 16, 14, 20, 1.25  # px; Excalidraw's line height for Excalifont
EXCALIFONT = 5
PAD_X, PAD_Y, MIN_W, MIN_H = 20, 14, 120, 56  # room around a label inside its box; the smallest box
FRAME_ROOM = 28  # px a frame keeps around its boxes (Graphviz's own cluster margin is 8)
FRAME_TITLE_MEASURE = 22  # frame titles drawn at 16 are measured at this, so their strip clears the boxes below
INK, FRAME_LINE, FRAME_FILL, FRAME_INK = "#1e1e1e", "#ced4da", "#f8f9fa", "#495057"
# roomy defaults (a file's own values win); arrow labels measured a size up from the 14 they're drawn at, so Graphviz
# leaves them room beside their arrow
LAYOUT = ["-Gnodesep=0.8", "-Granksep=1.1", "-Gsplines=spline", "-Efontname=Helvetica", "-Efontsize=17"]
# a shape's share of its box that's usable for text: an ellipse's inscribed rectangle, a diamond's
ROOM = {"rectangle": 1.0, "ellipse": 1 / math.sqrt(2), "diamond": 0.5}
ELLIPSES = {"ellipse", "oval", "circle", "doublecircle", "point", "egg"}
DIAMONDS = {"diamond", "Mdiamond"}


# --- the panel's text metric (mods/excalidraw/main.js lineWidth): wide characters 1, a space 0.3, others 0.55 em ---
def _wide(c: int) -> bool:
    return (4352 <= c <= 4447 or 11904 <= c <= 42191 or 44032 <= c <= 55203 or 63744 <= c <= 64255
            or 65072 <= c <= 65103 or 65280 <= c <= 65376 or 65504 <= c <= 65510 or 127744 <= c <= 129791)


def line_width(text: str, size: float) -> float:
    return sum((1.0 if _wide(ord(ch)) else 0.3 if ch == " " else 0.55) * size for ch in text)


def text_size(text: str, size: float) -> tuple[float, float]:
    lines = text.split("\n")
    return max(line_width(line, size) for line in lines), len(lines) * size * LINE


def inner(box: dict) -> tuple[float, float]:
    """The room a box's shape leaves for its label."""
    k = ROOM[box["type"]]
    return box["width"] * k - 2 * PAD_X, box["height"] * k - 2 * PAD_Y


def box_size(kind: str, label: str) -> tuple[float, float]:
    w, h = text_size(label, FONT)
    k = ROOM[kind]
    return max(MIN_W, (w + 2 * PAD_X) / k), max(MIN_H, (h + 2 * PAD_Y) / k)


# --- Graphviz ---
def graphviz(dot: str) -> dict:
    r = subprocess.run(["dot", "-Tjson0", *LAYOUT], input=dot, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"Graphviz can't read it: {r.stderr.strip().splitlines()[0] if r.stderr.strip() else r.returncode}")
    return json.loads(r.stdout)


def _label(o: dict) -> str:
    raw = o.get("label")
    if raw is None or raw == "\\N":
        return o["name"]
    return raw.replace("\\n", "\n").replace("\\l", "\n").replace("\\r", "\n").replace("\\N", o["name"]).strip("\n")


def _kind(shape: str | None) -> str:
    return "ellipse" if shape in ELLIPSES else "diamond" if shape in DIAMONDS else "rectangle"


def _q(s: str) -> str:
    return '"' + s.replace('"', '\\"') + '"'


def _spline(pos: str, at) -> list[list[float]]:
    """Graphviz's edge pos ("e,x,y p0 p1 ... pn", cubic Bézier) -> points along the curve, the arrow's tip last."""
    first = (pos or "").split(";")[0].split()
    end, start, ctrl = None, None, []
    for tok in first:
        if tok[:2] in ("e,", "s,"):
            x, y = map(float, tok[2:].split(","))
            (end := at(x, y)) if tok[0] == "e" else (start := at(x, y))
        else:
            x, y = map(float, tok.split(","))
            ctrl.append(at(x, y))
    out = [start] if start else []
    for i in range(0, len(ctrl) - 3, 3):
        a, b, c, d = ctrl[i:i + 4]
        for k in range(0 if i == 0 else 1, 5):
            u = k / 4
            v = 1 - u
            out.append([v**3 * a[j] + 3 * v * v * u * b[j] + 3 * v * u * u * c[j] + u**3 * d[j] for j in (0, 1)])
    if end:
        out.append(end)
    return out


# --- elements ---
def _base(id_: str, type_: str, x: float, y: float, w: float, h: float, **more) -> dict:
    return {"id": id_, "type": type_, "x": round(x, 1), "y": round(y, 1), "width": round(w, 1), "height": round(h, 1), "angle": 0,
            "strokeColor": INK, "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
            "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None, "roundness": None, "boundElements": [],
            "seed": random.randint(1, 2**31), "version": 1, "versionNonce": random.randint(1, 2**31), "isDeleted": False,
            "updated": int(time.time() * 1000), "link": None, "locked": False, **more}


def _text(id_: str, text: str, x: float, y: float, size: float, container: str | None, colour: str = INK, align: str = "center") -> dict:
    w, h = text_size(text, size)
    return _base(id_, "text", x, y, w, h, strokeColor=colour, text=text, originalText=text, fontSize=size, fontFamily=EXCALIFONT,
                 textAlign=align, verticalAlign="middle" if container else "top", containerId=container, lineHeight=LINE, autoResize=True)


def convert(dot: str, prefix: str | None = None) -> list[dict]:
    """DOT text -> Excalidraw elements (frames first, so they sit behind)."""
    prefix = prefix or "".join(random.choices(string.ascii_lowercase, k=5))
    first = graphviz(dot)
    objs = first.get("objects", [])
    nodes = [o for o in objs if "nodes" not in o and "name" in o and not o["name"].startswith("cluster")]
    sizes = {o["name"]: box_size(_kind(o.get("shape")), _label(o)) for o in nodes}
    fixed = "".join(f"  {_q(n)} [width={w / 72:.3f}, height={h / 72:.3f}, fixedsize=true];\n" for n, (w, h) in sizes.items())
    # every frame reopened with room around its boxes and under its title (a bigger margin of the file's own stays)
    fixed += "".join(f"  subgraph {_q(o['name'])} {{ graph [margin={max(FRAME_ROOM, float(o.get('margin') or 0)):g}, fontsize={FRAME_TITLE_MEASURE}, labeljust=l]; }}\n"
                     for o in objs if "nodes" in o and o.get("name", "").startswith("cluster"))
    end = dot.rstrip().rfind("}")
    laid = graphviz(dot[:end] + fixed + dot[end:])  # Graphviz places the boxes at the sizes their text needs
    height = float(laid.get("bb", "0,0,0,0").split(",")[3])
    at = lambda x, y: [x, height - y]  # noqa: E731  points, y up -> px, y down
    pid = lambda name: f"{prefix}-{name}"  # noqa: E731
    by_gvid = {o["_gvid"]: o for o in laid.get("objects", [])}
    frames, boxes, words, arrows = [], {}, [], []

    for o in laid.get("objects", []):
        if "nodes" in o and o.get("name", "").startswith("cluster") and o.get("bb"):
            x0, y0, x1, y1 = map(float, o["bb"].split(","))
            f = _base(pid(o["name"]), "rectangle", x0, height - y1, x1 - x0, y1 - y0, strokeColor=FRAME_LINE, backgroundColor=FRAME_FILL,
                      roughness=0, roundness={"type": 3})
            frames.append(f)
            if o.get("label"):
                frames.append(_text(pid(o["name"]) + "-title", o["label"], x0 + 12, height - y1 + 8, FONT, None, FRAME_INK, "left"))
    for o in (by_gvid[g] for g in sorted(by_gvid) if "nodes" not in by_gvid[g] and not by_gvid[g].get("name", "").startswith("cluster")):
        src = next(n for n in nodes if n["name"] == o["name"])
        if "invis" in (src.get("style") or ""):
            continue
        w, h = sizes[o["name"]]
        cx, cy = at(*map(float, o["pos"].split(",")))
        kind, style = _kind(src.get("shape")), set((src.get("style") or "").replace(" ", "").split(","))
        b = _base(pid(o["name"]), kind, cx - w / 2, cy - h / 2, w, h, strokeColor=src.get("color") or INK,
                  backgroundColor=src.get("fillcolor", "transparent") if "filled" in style else "transparent",
                  strokeStyle="dashed" if "dashed" in style else "solid", roundness={"type": 3} if kind == "rectangle" else {"type": 2})
        label = _label(src)
        tw, th = text_size(label, FONT)
        t = _text(b["id"] + "-text", label, cx - tw / 2, cy - th / 2, FONT, b["id"], src.get("fontcolor") or INK)
        b["boundElements"].append({"id": t["id"], "type": "text"})
        boxes[o["name"]] = b
        words.append(t)
    for i, e in enumerate(laid.get("edges", [])):
        if "invis" in (e.get("style") or ""):  # Graphviz's layout helpers, never drawn
            continue
        tail, head = by_gvid[e["tail"]]["name"], by_gvid[e["head"]]["name"]
        pts = _spline(e.get("pos", ""), at)
        if len(pts) < 2 or tail not in boxes or head not in boxes:
            continue
        x0, y0 = pts[0]
        rel = [[round(px - x0, 1), round(py - y0, 1)] for px, py in pts]
        xs, ys = [p[0] for p in rel], [p[1] for p in rel]
        style = set((e.get("style") or "").replace(" ", "").split(","))
        a = _base(pid(f"e{i}"), "arrow", x0, y0, max(xs) - min(xs), max(ys) - min(ys), points=rel, strokeColor=e.get("color") or INK,
                  strokeStyle="dashed" if "dashed" in style else "dotted" if "dotted" in style else "solid", roundness={"type": 2},
                  startBinding={"elementId": boxes[tail]["id"], "focus": 0, "gap": 6}, endBinding={"elementId": boxes[head]["id"], "focus": 0, "gap": 6},
                  startArrowhead=None, endArrowhead="arrow", elbowed=False, groupIds=[pid(f"g{i}")])
        boxes[tail]["boundElements"].append({"id": a["id"], "type": "arrow"})
        boxes[head]["boundElements"].append({"id": a["id"], "type": "arrow"})
        arrows.append(a)
        if e.get("label"):  # beside the arrow where Graphviz put it, grouped with it so they move together
            lx, ly = at(*map(float, e["lp"].split(","))) if e.get("lp") else pts[len(pts) // 2]
            lw, lh = text_size(_label({"name": "", "label": e["label"]}), ARROW_FONT)
            words.append({**_text(a["id"] + "-label", _label({"name": "", "label": e["label"]}), lx - lw / 2, ly - lh / 2, ARROW_FONT, None),
                          "groupIds": [pid(f"g{i}")]})
    title = [_text(pid("title"), first["label"], 0, -TITLE_FONT * 2.5, TITLE_FONT, None, INK, "left")] if first.get("label") else []
    out = title + frames + list(boxes.values()) + arrows + words
    return _clear_labels(out)


def _clear_labels(elements: list[dict]) -> list[dict]:
    """An arrow label Graphviz left on another arrow or a shape moves to the nearest clear spot around it."""
    out = list(elements)
    for i, e in enumerate(out):
        if e["type"] != "text" or not e["id"].endswith("-label") or not problems_of(out, e):
            continue
        h = e["height"]
        for step in range(1, 7):
            spots = [(0, -step * h), (0, step * h), (-step * h, 0), (step * h, 0)]
            moved = next((m for m in ({**e, "x": e["x"] + dx, "y": e["y"] + dy} for dx, dy in spots) if not problems_of(out[:i] + [m] + out[i + 1:], m)), None)
            if moved:
                out[i] = moved
                break
    return out


def problems_of(elements: list[dict], e: dict) -> list[str]:
    """The check's findings about one text element."""
    return [p for p in problems(elements) if f'text "{e.get("text", "")}"' in p]


# --- the check (the skill's last step): nothing overlaps, arrows go around shapes, words sit off arrows ---
def _box(e: dict) -> tuple[float, float, float, float]:
    return e["x"], e["y"], e["x"] + e.get("width", 0), e["y"] + e.get("height", 0)


def _meets(a: tuple, b: tuple) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _holds(outer: tuple, inner: tuple) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


def _crosses(p: tuple, q: tuple, box: tuple) -> bool:
    """Does the segment p-q pass through the box (Liang-Barsky)?"""
    t0, t1, dx, dy = 0.0, 1.0, q[0] - p[0], q[1] - p[1]
    for d, lo, hi, v in ((dx, box[0], box[2], p[0]), (dy, box[1], box[3], p[1])):
        if d == 0:
            if not lo < v < hi:
                return False
            continue
        a, b = (lo - v) / d, (hi - v) / d
        t0, t1 = max(t0, min(a, b)), min(t1, max(a, b))
        if t0 >= t1:
            return False
    return True


def problems(elements: list[dict]) -> list[str]:
    """What's wrong with a drawing's layout: shapes that overlap, arrows through a shape they don't start or end at,
    words on an arrow or half over a shape. A rectangle holding other shapes is a frame: arrows and its title may cross
    it."""
    live = [e for e in elements if not e.get("isDeleted")]
    shapes = [e for e in live if e["type"] in ("rectangle", "ellipse", "diamond", "image")]
    box = {e["id"]: _box(e) for e in shapes}
    frames = {e["id"] for e in shapes if e["type"] == "rectangle" and any(o is not e and _holds(box[e["id"]], box[o["id"]]) for o in shapes)}
    plain = [e for e in shapes if e["id"] not in frames]
    arrows = [e for e in live if e["type"] in ("arrow", "line") and len(e.get("points") or []) > 1]
    path = {a["id"]: [(a["x"] + px, a["y"] + py) for px, py in a["points"]] for a in arrows}
    on = lambda a, b: any(_crosses(path[a["id"]][k], path[a["id"]][k + 1], b) for k in range(len(path[a["id"]]) - 1))  # noqa: E731
    out = []
    for i, a in enumerate(plain):
        out += [f"shapes {a['id']} and {b['id']} overlap" for b in plain[i + 1:] if _meets(box[a["id"]], box[b["id"]])]
    for a in arrows:
        ends = {(a.get("startBinding") or {}).get("elementId"), (a.get("endBinding") or {}).get("elementId")}
        out += [f"arrow {a['id']} crosses shape {s['id']}" for s in plain if s["id"] not in ends and on(a, box[s["id"]])]
    for w in (e for e in live if e["type"] == "text" and not e.get("containerId")):
        wb = _box(w)
        out += [f'text "{w.get("text", "")}" sits on arrow {a["id"]}' for a in arrows if on(a, wb)]
        out += [f'text "{w.get("text", "")}" overlaps shape {s["id"]}' for s in plain if _meets(wb, box[s["id"]]) and not _holds(box[s["id"]], wb)]
    return out


def place_beside(existing: list[dict], new: list[dict], gap: float = 160) -> list[dict]:
    """The new elements moved to the right of what's already drawn, tops aligned."""
    live = [e for e in existing if not e.get("isDeleted")]
    if not live or not new:
        return new
    dx = max(e["x"] + e.get("width", 0) for e in live) + gap - min(e["x"] for e in new)
    dy = min(e["y"] for e in live) - min(e["y"] for e in new)
    return [{**e, "x": round(e["x"] + dx, 1), "y": round(e["y"] + dy, 1)} for e in new]


def repo_tag(cwd: str, existing: str = "") -> str:
    """appState.herdr_repos: the repos a drawing covers, comma separated, ~ for home; the library files it under them."""
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True)
    tags = [t.strip() for t in existing.split(",") if t.strip()]
    if r.returncode == 0:
        top, home = os.path.realpath(r.stdout.strip()), os.path.realpath(os.path.expanduser("~"))
        tag = "~" + top[len(home):] if top == home or top.startswith(home + os.sep) else top
        if tag not in tags:
            tags.append(tag)
    return ",".join(tags)


def open_in_panel(path: str) -> None:
    home = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
    os.makedirs(f"{home}/data/excalidraw", exist_ok=True)
    with open(f"{home}/data/excalidraw/open.json", "w") as f:
        json.dump({"file": os.path.abspath(path)}, f, indent=1)
        f.write("\n")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("dot", nargs="?", help="a DOT file (default: stdin)")
    p.add_argument("-o", "--out", help="write a new drawing here")
    p.add_argument("--into", help="add to this drawing, beside what's there")
    p.add_argument("--open", action="store_true", help="show the drawing in Herdr's Excalidraw panel")
    p.add_argument("--check", metavar="FILE", help="list what overlaps in a drawing (exit 1 if anything does)")
    a = p.parse_args()
    if a.check:
        with open(a.check) as f:
            found = problems(json.load(f).get("elements", []))
        print("\n".join(found) or "ok: nothing overlaps")
        sys.exit(1 if found else 0)
    if a.dot:
        with open(a.dot) as f:
            dot = f.read()
    else:
        dot = sys.stdin.read()
    new = convert(dot)
    if a.into:
        doc = {"type": "excalidraw", "elements": []}
        if os.path.exists(a.into):
            with open(a.into) as f:
                doc = json.load(f)
        doc = {"type": "excalidraw", "version": 2, "source": "herdr-excalidraw", "appState": {"viewBackgroundColor": "#ffffff"}, "files": {},
               **doc, "elements": doc.get("elements", []) + place_beside(doc.get("elements", []), new)}
        target = a.into
    else:
        doc = {"type": "excalidraw", "version": 2, "source": "herdr-excalidraw", "elements": new, "appState": {"viewBackgroundColor": "#ffffff"}, "files": {}}
        target = a.out
    tag = repo_tag(os.getcwd(), doc.get("appState", {}).get("herdr_repos", ""))
    if tag:
        doc = {**doc, "appState": {**doc.get("appState", {}), "herdr_repos": tag}}
    text = json.dumps(doc, indent=1)
    if not target:
        print(text)
        return
    with open(target, "w") as f:
        f.write(text + "\n")
    if a.open:
        open_in_panel(target)


if __name__ == "__main__":
    main()
