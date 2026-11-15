import { test, expect } from "bun:test";
import { monotone, stack, radarPoint } from "./geom.js";

test("monotone: passes through every point and never overshoots between them", () => {
  const pts = [[0, 10], [10, 0], [20, 0], [30, 8]];
  const seg = monotone(pts);
  expect(seg.length).toBe(3);
  expect(seg.map((s) => s.to)).toEqual(pts.slice(1));
  // a flat stretch stays flat: both control points on the line
  expect(seg[1].c1[1]).toBe(0);
  expect(seg[1].c2[1]).toBe(0);
  // controls stay inside each step's range of y
  for (const [i, s] of seg.entries()) {
    const lo = Math.min(pts[i][1], pts[i + 1][1]), hi = Math.max(pts[i][1], pts[i + 1][1]);
    for (const c of [s.c1, s.c2]) { expect(c[1]).toBeGreaterThanOrEqual(lo); expect(c[1]).toBeLessThanOrEqual(hi); }
  }
  expect(monotone([[0, 1]])).toEqual([]);
});

test("stack: each harness's layer sits on the ones below it, in order", () => {
  const buckets = [{ cost: { omp: 1, claude: 2 } }, { cost: { claude: 4 } }];
  expect(stack(buckets, "cost", ["omp", "claude", "codex"])).toEqual([
    { h: "omp", lo: [0, 0], hi: [1, 0] },
    { h: "claude", lo: [1, 0], hi: [3, 4] },
  ]);
});

test("radarPoint: axis 0 points up, the rest go clockwise", () => {
  const [x0, y0] = radarPoint(0, 4, 1, 50, 50, 40), [x1, y1] = radarPoint(1, 4, 0.5, 50, 50, 40);
  expect([Math.round(x0), Math.round(y0)]).toEqual([50, 10]);
  expect([Math.round(x1), Math.round(y1)]).toEqual([70, 50]);
});
