// Our parts of the Excalidraw mod (SOURCE.md): the theme and the agent handoff.
import { test, expect } from "bun:test";
import { isDark, darkInk, canvasColor, uiColors, LIGHT_UI } from "./theme.js";
import { requestedFile, openRecord } from "./handoff.js";
import { placed } from "./placed.js";

test("isDark: from the theme's background colour", () => {
  expect(isDark({ background: "#0b0b0c" })).toBe(true);
  expect(isDark({ background: "#ffffff" })).toBe(false);
  expect(isDark({})).toBe(false); // no colour: Excalidraw's own light look
});

test("darkInk: Excalidraw's dark mode (invert 93%, hue-rotate 180°): white paper reads #121212, ink turns light, hue kept", () => {
  expect(darkInk("#ffffff")).toBe("#121212");
  expect(darkInk("#1e1e1e")).toBe("#d3d3d3");
  const blue = darkInk("#1971c2"); // still a blue: blue channel highest
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(blue.slice(i, i + 2), 16));
  expect(b).toBeGreaterThan(r);
  expect(b).toBeGreaterThan(g - 1);
  expect(darkInk("#1e1e1e80")).toBe("#d3d3d380"); // alpha kept
  expect(darkInk(null)).toBe(null);
});

test("canvas and tool colours: black in a dark theme, white in a light one", () => {
  const dark = { background: "#000000", popover: "#18181b", border: "#27272a", input: "#3f3f46", foreground: "#fafafa", muted: "#a1a1aa", selected: "#27272a", hover: "#1f1f23" };
  expect(canvasColor(dark)).toBe("#000000");
  expect(canvasColor({ background: "#fafafa" })).toBe("#ffffff");
  expect(uiColors(dark)).toMatchObject({ surface: "#18181b", foreground: "#fafafa", border: "#27272a" });
  expect(uiColors({ background: "#ffffff" })).toEqual(LIGHT_UI);
});

test("handoff: open.json names a drawing; only a different, absolute (or ~) one is a request", () => {
  expect(requestedFile('{"file":"/tmp/a.excalidraw"}', "/tmp/b.excalidraw", "/Users/me")).toBe("/tmp/a.excalidraw");
  expect(requestedFile('{"file":"~/d/a.excalidraw"}', null, "/Users/me")).toBe("/Users/me/d/a.excalidraw");
  expect(requestedFile('{"file":"/tmp/a.excalidraw"}', "/tmp/a.excalidraw", "/Users/me")).toBe(null); // already open
  expect(requestedFile('{"file":"/private/tmp/a.excalidraw"}', "/tmp/a.excalidraw", "/Users/me")).toBe(null); // the same file
  expect(requestedFile('{"file":"relative.excalidraw"}', null, "/Users/me")).toBe(null);
  expect(requestedFile("not json", null, "/Users/me")).toBe(null);
  expect(JSON.parse(openRecord("/tmp/a.excalidraw"))).toEqual({ file: "/tmp/a.excalidraw" });
});

test("backdrop.js is the Agents graph's backdrop, unchanged (the canvas shares its Background, strength and grain)", async () => {
  const mine = await import("./backdrop.js"), theirs = await import("../agent-graph/lib.js");
  for (const k of ["backdrop", "dotsAlpha", "grainOpacity"]) expect(mine[k].toString()).toBe(theirs[k].toString());
  expect(mine.PATTERNS).toEqual(theirs.PATTERNS);
});

test("cardsOf: the boxes the background follows, on screen: shapes, not arrows, words or frames around other boxes", async () => {
  const { cardsOf } = await import("./ground.js");
  const els = [
    { id: "a", type: "rectangle", x: 10, y: 10, width: 100, height: 50 },
    { id: "e", type: "ellipse", x: 200, y: 10, width: 60, height: 60 },
    { id: "frame", type: "rectangle", x: 0, y: 0, width: 300, height: 100 }, // holds a and e: a frame
    { id: "arr", type: "arrow", x: 0, y: 0, width: 900, height: 900, points: [[0, 0], [900, 900]] },
    { id: "t", type: "text", x: 400, y: 400, width: 50, height: 20 },
    { id: "gone", type: "diamond", x: 0, y: 0, width: 10, height: 10, isDeleted: true },
  ];
  expect(cardsOf(els, 2, 5, 0)).toEqual([{ x: 30, y: 20, w: 200, h: 100 }, { x: 410, y: 20, w: 120, h: 120 }]);
});

test("alphaHex: the dot ink at a strength, nothing when it would be invisible", async () => {
  const { alphaHex } = await import("./ground.js");
  expect(alphaHex("#fafafa", 0.25)).toBe("#fafafa40");
  expect(alphaHex("#fafafaff", 1)).toBe("#fafafaff");
  expect(alphaHex("#fafafa", 0.001)).toBe(null);
  expect(alphaHex("not a colour", 0.5)).toBe(null);
});

test("placed: an element without finite coordinates (NaN saves as null) can't come in: one would make every bound NaN", () => {
  expect(placed({ x: 10, y: -4 })).toBe(true);
  expect(placed({ x: 0, y: 0, points: [[0, 0], [3.5, -2]] })).toBe(true);
  expect(placed({ x: null, y: 5 })).toBe(false);
  expect(placed({ x: 5, y: NaN })).toBe(false);
  expect(placed({ y: 5 })).toBe(false);
  expect(placed({ x: 1, y: 1, points: [[0, 0], [null, 2]] })).toBe(false);
});
