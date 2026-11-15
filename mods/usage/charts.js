// Usage's charts. Herdr mods get no chart elements (gpui-kit's charts are Rust-only, and there's no web view), so
// these draw with gpui-kit's PathBuilder: stacked smooth areas and radars, the geometry pure and tested.
import { div, PathBuilder, Background } from "gpui-kit";
import { monotone, stack, radarPoint } from "./geom.js";


// Through the points after the first: smooth (monotone) or straight, which invents nothing between them.
const curve = (b, pts, smooth = true) => {
  if (!smooth) { for (const p of pts.slice(1)) b = b.line_to(p[0], p[1]); return b; }
  for (const s of monotone(pts)) b = b.cubic_bezier_to(s.to[0], s.to[1], s.c1[0], s.c1[1], s.c2[0], s.c2[1]);
  return b;
};
const layer = (w, h, path, paint) => div().absolute().left(0).top(0).w(w).h(h).child(window.paint_path(path, paint));
const hex = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");
// A layer's fill, made once per colour and reused (a native Background is reusable), not on every frame.
const fills = new Map();
const fillOf = (c) => fills.get(c) ?? fills.set(c, Background.linear_gradient(180, Background.stop(hex(c, 0.42), 0), Background.stop(hex(c, 0.1), 100))).get(c);

// Stacked areas (smooth, or straight when there are few points to join), w x h, one point per bucket spread edge to edge (a single bucket spans the width): each
// harness's layer in a soft vertical gradient of its colour under a crisp top line, faint dashed gridlines behind.
export function areas(t, { w, h, buckets, field, order, colors, max, smooth = true }) {
  const n = buckets.length, X = (i) => (n > 1 ? (i / (n - 1)) * w : 0), Y = (v) => h - (v / max) * (h - 2);
  const xs = n > 1 ? buckets.map((_, i) => X(i)) : [0, w];
  const pts = (vals) => (n > 1 ? vals : [vals[0], vals[0]]).map((v, i) => [xs[i], Y(v)]);
  let grid = PathBuilder.stroke(1).dash_array([3, 4]);
  for (const f of [0.5, 1]) grid = grid.move_to(0, Y(max * f)).line_to(w, Y(max * f));
  const els = [layer(w, h, grid.build(), hex(t.border, 0.9))];
  for (const L of stack(buckets, field, order)) {
    const top = pts(L.hi), bottom = pts(L.lo).reverse();
    const fill = curve(PathBuilder.fill().move_to(...top[0]), top, smooth).line_to(...bottom[0]);
    els.push(layer(w, h, curve(fill, bottom, smooth).close().build(), fillOf(colors[L.h])));
    // its top line only where it's more than a sliver (2% of the height): a thin layer would otherwise outline the stack
    const thick = (n > 1 ? L.hi.map((v, i) => v - L.lo[i]) : [L.hi[0] - L.lo[0], L.hi[0] - L.lo[0]]);
    const segs = smooth ? monotone(top) : top.slice(1).map((to) => ({ to }));
    let line = PathBuilder.stroke(1.5), pen = false, drawn = false;
    segs.forEach((g, i) => {
      if (!(thick[i] > max * 0.02 || thick[i + 1] > max * 0.02)) { pen = false; return; } // a sliver isn't drawn over
      if (!pen) { line = line.move_to(...top[i]); pen = true; }
      line = smooth ? line.cubic_bezier_to(g.to[0], g.to[1], g.c1[0], g.c1[1], g.c2[0], g.c2[1]) : line.line_to(g.to[0], g.to[1]);
      drawn = true;
    });
    if (drawn) els.push(layer(w, h, line.build(), colors[L.h]));
  }
  return els;
}

// A radar, size x size: rings at 50% and 100% (labelled on the first spoke), a spoke per axis, and the shape drawn
// only between neighbouring measured axes: a filled wedge and an edge for each such pair, a dot on every measured
// axis. An unmeasured axis isn't a zero: the outline breaks there, its spoke is dashed and its label dimmed.
export function radar(t, { size, labels, values, color, pad = 30 }) {
  const n = labels.length, c = size / 2, r = c - pad, P = (i, v) => radarPoint(i, n, v, c, c, r);
  let rings = PathBuilder.stroke(1), dashed = PathBuilder.stroke(1).dash_array([2, 3]), edges = PathBuilder.stroke(1.5), wedges = PathBuilder.fill();
  for (const f of [0.5, 1]) rings = rings.add_polygon(labels.map((_, i) => P(i, f)), true);
  let anyEdge = false;
  for (let i = 0; i < n; i++) {
    if (values[i] == null) dashed = dashed.move_to(c, c).line_to(...P(i, 1));
    else rings = rings.move_to(c, c).line_to(...P(i, 1));
    const j = (i + 1) % n;
    if (values[i] != null && values[j] != null) {
      anyEdge = true;
      wedges = wedges.add_polygon([[c, c], P(i, values[i]), P(j, values[j])], true);
      edges = edges.move_to(...P(i, values[i])).line_to(...P(j, values[j]));
    }
  }
  const els = [layer(size, size, rings.build(), hex(t.border, 1)), layer(size, size, dashed.build(), hex(t.border, 0.8))];
  if (anyEdge) els.push(layer(size, size, wedges.build(), hex(color, 0.22)), layer(size, size, edges.build(), color));
  for (const f of [0.5, 1]) els.push(div().absolute().left(c + 4).top(c - r * f - 6).text_size(9).text_color(t.dim).child(`${f * 100}%`));
  values.forEach((v, i) => {
    if (v != null) { const [x, y] = P(i, v); els.push(div().absolute().left(x - 3).top(y - 3).size(6).rounded_full().bg(color)); }
    const [lx, ly] = radarPoint(i, n, 1, c, c, r + 14);
    els.push(div().absolute().left(lx - 40).top(ly - 7).w(80).text_center().text_size(10).text_color(v == null ? t.dim : t.muted).child(labels[i]));
  });
  return div().relative().size(size).flex_none().children(els);
}
