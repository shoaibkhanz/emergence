// The library's previews: a drawing's shapes as outlines in one ink, fitted, no words.
import { test, expect } from "bun:test";
import { previewSvg, PREVIEW_INK } from "./preview.js";

const box = (id, x, y, more = {}) => ({ id, type: "rectangle", x, y, width: 100, height: 50, ...more });

test("previewSvg: every shape drawn in one ink, fitted inside the preview, words left out", () => {
  const svg = previewSvg([box("a", 0, 0), { id: "e", type: "ellipse", x: 200, y: 0, width: 80, height: 80 },
    { id: "d", type: "diamond", x: 0, y: 200, width: 60, height: 60 }, { id: "l", type: "arrow", x: 100, y: 25, points: [[0, 0], [100, 15]] },
    { id: "t", type: "text", x: 0, y: 300, width: 90, height: 20, text: "secret words", containerId: null },
    { id: "gone", type: "rectangle", x: 5000, y: 5000, width: 10, height: 10, isDeleted: true }], 144, 88);
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain("<rect");
  expect(svg).toContain("<ellipse");
  expect(svg).toContain("<polygon");
  expect(svg).toContain("<polyline");
  expect(svg).not.toContain("secret");
  for (const [, c] of svg.matchAll(/(?:stroke|fill)="(#[0-9a-f]{6})"/g)) expect(c).toBe(PREVIEW_INK);
  const nums = [...svg.matchAll(/(?:x|cx|y|cy)="(-?[\d.]+)"/g)].map((m) => Number(m[1])); // fitted: nothing outside 0..144
  for (const n of nums) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(144); }
});

test("previewSvg: an empty drawing is an empty picture, not an error", () => {
  expect(previewSvg([], 144, 88)).toMatch(/^<svg[^>]*><\/svg>$/);
});
