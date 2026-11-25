// The export's pure part: PathBuilder calls -> SVG path data, colours, and the SVG document.
import { expect, test } from "bun:test";
import { pathData, splitColor, toSvg } from "./export.js";

test("pathData: records the PathBuilder calls a piece emits, as SVG path data", () => {
  const d = pathData((b) => b.move_to(0, 0).line_to(10, 0).cubic_bezier_to(20, 20, 12, 2, 18, 8).curve_to(30, 0, 25, 5).close());
  expect(d).toBe("M0 0 L10 0 C12 2 18 8 20 20 Q25 5 30 0 Z");
  expect(pathData((b) => b.move_to(1.23456, 2))).toBe("M1.23 2");
});

test("splitColor: #rrggbbaa into a colour and an opacity SVG viewers all read", () => {
  expect(splitColor("#1e1e1e")).toEqual({ color: "#1e1e1e", opacity: 1 });
  expect(splitColor("#1e1e1e80")).toEqual({ color: "#1e1e1e", opacity: 0.502 });
});

const rect = { bounds: [10, 20, 110, 70], images: [], texts: [],
  pieces: [{ fill: false, width: 2, color: "#1971c2", dash: [8, 10], emit: (b) => b.move_to(10, 20).line_to(110, 20).close() },
    { fill: true, width: 0, color: "#a5d8ff80", dash: null, emit: (b) => b.move_to(10, 20).line_to(110, 70).close() }] };
const label = { bounds: [0, 100, 80, 125], pieces: [], images: [],
  texts: [{ x: 0, y: 100, w: 80, h: 25, lines: ["a <b> & c"], fontSize: 20, lineHeight: 1.25, font: "Excalifont", color: "#1e1e1e", align: "center" }] };

test("toSvg: the drawing's bounds plus padding; strokes and fills as the canvas draws them", () => {
  const { svg, width, height } = toSvg([rect], { background: "#ffffff", pad: 10 });
  expect([width, height]).toEqual([120, 70]);
  expect(svg).toContain('viewBox="0 10 120 70"');
  expect(svg).toContain('<rect x="0" y="10" width="120" height="70" fill="#ffffff"/>');
  expect(svg).toContain('<path d="M10 20 L110 20 Z" fill="none" stroke="#1971c2" stroke-width="2" stroke-dasharray="8 10"');
  expect(svg).toContain('<path d="M10 20 L110 70 Z" fill="#a5d8ff" fill-opacity="0.502"/>');
});

test("toSvg: text per line, escaped, centred in its line box; the font embedded only when given and used", () => {
  const { svg } = toSvg([label], { background: "#ffffff", pad: 0, font: "QUJD" });
  expect(svg).toContain('<text x="40" y="112.5" font-family="Excalifont" font-size="20" fill="#1e1e1e" text-anchor="middle" dominant-baseline="central">a &lt;b&gt; &amp; c</text>');
  expect(svg).toContain("url(data:font/ttf;base64,QUJD)");
  expect(toSvg([rect], { background: "#ffffff", pad: 0, font: "QUJD" }).svg).not.toContain("@font-face");
});

test("toSvg square: the drawing centred in a square (for qlmanage's square PNG, cropped back after)", () => {
  const { svg, width, height, side } = toSvg([rect], { background: "#ffffff", pad: 0, square: true });
  expect([width, height, side]).toEqual([100, 50, 100]);
  expect(svg).toContain('viewBox="10 -5 100 100"');
});
