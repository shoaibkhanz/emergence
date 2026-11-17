// Copy and paste on the canvas (clipboard.js): Excalidraw's own clipboard format, so it pastes between drawings and
// into excalidraw.com and back; copies get fresh ids with their text, arrows and groups joined up among themselves.
import { test, expect } from "bun:test";
import { copyText, pasted } from "./clipboard.js";

const box = { id: "b1", type: "rectangle", x: 0, y: 0, width: 100, height: 50, groupIds: [], boundElements: [{ id: "t1", type: "text" }, { id: "a1", type: "arrow" }] };
const label = { id: "t1", type: "text", x: 20, y: 15, width: 60, height: 20, text: "API", containerId: "b1", groupIds: [] };
const other = { id: "b2", type: "ellipse", x: 300, y: 0, width: 80, height: 80, groupIds: [], boundElements: [{ id: "a1", type: "arrow" }] };
const arrow = { id: "a1", type: "arrow", x: 100, y: 25, width: 200, height: 0, points: [[0, 0], [200, 0]], groupIds: [],
  startBinding: { elementId: "b1", focus: 0, gap: 6 }, endBinding: { elementId: "b2", focus: 0, gap: 6 } };
const all = [box, label, other, arrow];

test("copyText: the selection with the text inside it, as Excalidraw's clipboard JSON; nothing selected, nothing", () => {
  const doc = JSON.parse(copyText(all, ["b1"]));
  expect(doc.type).toBe("excalidraw/clipboard");
  expect(doc.elements.map((e) => e.id).sort()).toEqual(["b1", "t1"]);
  expect(copyText(all, [])).toBe(null);
  expect(copyText([{ ...box, isDeleted: true }], ["b1"])).toBe(null);
});

test("pasted: fresh ids, text joined to its copied shape, arrows to copied ends only, centred where asked", () => {
  let n = 0;
  const id = () => `n${++n}`;
  const out = pasted(copyText(all, ["b1", "b2", "a1"]), { x: 1000, y: 1000 }, id);
  expect(out.length).toBe(4);
  const by = Object.fromEntries(out.map((e) => [e.type === "text" ? "label" : e.type, e]));
  expect(out.every((e) => !["b1", "t1", "b2", "a1"].includes(e.id))).toBe(true);
  expect(by.label.containerId).toBe(by.rectangle.id);
  expect(by.rectangle.boundElements).toEqual([{ id: by.label.id, type: "text" }, { id: by.arrow.id, type: "arrow" }]);
  expect([by.arrow.startBinding.elementId, by.arrow.endBinding.elementId]).toEqual([by.rectangle.id, by.ellipse.id]);
  const xs = out.flatMap((e) => [e.x, e.x + e.width]), ys = out.flatMap((e) => [e.y, e.y + e.height]);
  expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(1000, 0);
  expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(1000, 0);
});

test("pasted: an arrow copied without one of its ends lets go of it; groups get new ids, still shared", () => {
  let n = 0;
  const id = () => `n${++n}`;
  const lone = pasted(copyText(all, ["a1"]), { x: 0, y: 0 }, id);
  expect(lone[0].startBinding).toBe(null);
  expect(lone[0].endBinding).toBe(null);
  const grouped = [{ ...box, groupIds: ["g"], boundElements: [] }, { ...other, groupIds: ["g"], boundElements: [] }];
  const g = pasted(copyText(grouped, ["b1", "b2"]), { x: 0, y: 0 }, id);
  expect(g[0].groupIds).toEqual(g[1].groupIds);
  expect(g[0].groupIds[0]).not.toBe("g");
});

test("pasted: plain text from elsewhere becomes a text element; empty or nothing pastes nothing", () => {
  const [t] = pasted("hello there", { x: 50, y: 50 }, () => "t", { fontSize: 20 });
  expect(t).toMatchObject({ id: "t", type: "text", text: "hello there", originalText: "hello there", fontSize: 20, containerId: null });
  expect(pasted("   ", { x: 0, y: 0 }, () => "x")).toEqual([]);
  expect(pasted(undefined, { x: 0, y: 0 }, () => "x")).toEqual([]);
});
