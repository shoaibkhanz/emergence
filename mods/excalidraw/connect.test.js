// Connecting shapes (connect.js): the dots on a shape's edges, ⌘+arrow's flowchart previews, ⌥+arrow's neighbour.
import { test, expect } from "bun:test";
import { edgeDots, dotAt, flowchart, neighbour, GAP } from "./connect.js";

const box = (id, x, y, more = {}) => ({ id, type: "rectangle", x, y, width: 100, height: 60, groupIds: [], boundElements: [], strokeColor: "#1e1e1e",
  backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, roundness: { type: 3 }, ...more });
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("edgeDots: the middle of each edge, top, right, bottom, left; dotAt finds one within reach", () => {
  const a = box("a", 0, 0);
  expect(edgeDots(a)).toEqual([{ side: "up", x: 50, y: 0 }, { side: "right", x: 100, y: 30 }, { side: "down", x: 50, y: 60 }, { side: "left", x: 0, y: 30 }]);
  expect(dotAt([a], { x: 103, y: 28 }, 8)).toMatchObject({ id: "a", side: "right", x: 100, y: 30 });
  expect(dotAt([a], { x: 50, y: 30 }, 8)).toBe(null);
});

test("flowchart: one preview a GAP away, the parent's size and look, joined by an arrow bound at both ends", () => {
  let n = 0;
  const a = box("a", 0, 0), { nodes, arrows, source } = flowchart(a, "right", 1, [a], null, () => `n${++n}`);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ type: "rectangle", x: 100 + GAP, y: 0, width: 100, height: 60, backgroundColor: "#a5d8ff" });
  expect(arrows[0]).toMatchObject({ type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: nodes[0].id } });
  expect(nodes[0].boundElements).toEqual([{ id: arrows[0].id, type: "arrow" }]);
  expect(source.boundElements).toEqual([{ id: arrows[0].id, type: "arrow" }]);
  const down = flowchart(a, "down", 1, [a], null, () => "x").nodes[0];
  expect([down.x, down.y]).toEqual([0, 60 + GAP]);
});

test("flowchart: four previews stack along the other axis, a GAP apart, centred on the parent", () => {
  const a = box("a", 0, 0), { nodes } = flowchart(a, "right", 4, [a], null, (() => { let n = 0; return () => `n${++n}`; })());
  expect(nodes.map((p) => p.x)).toEqual([200, 200, 200, 200]);
  expect(nodes.map((p) => p.y)).toEqual([-240, -80, 80, 240]); // 4 x 60 + 3 x 100 = 540 tall, centred on y = 30: -240, a step of 160
});

test("flowchart: a shape in the way moves the group to the nearest free spot; grown, the visible previews stay put", () => {
  const id = (() => { let n = 0; return () => `n${++n}`; })();
  const a = box("a", 0, 0), wall = box("wall", 210, -10); // right where the first preview would go
  const one = flowchart(a, "right", 1, [a, wall], null, id);
  expect(overlaps(one.nodes[0], wall)).toBe(false);
  const two = flowchart(a, "right", 2, [a, wall], one.crossStart, id);
  expect(two.nodes[0].y).toBe(one.nodes[0].y); // the first stays where it was
  for (const p of two.nodes) expect(overlaps(p, wall)).toBe(false);
});

test("flowchart: a frame around the parent isn't in the way", () => {
  const a = box("a", 0, 0), frame = box("frame", -40, -40, { width: 600, height: 300 });
  const { nodes } = flowchart(a, "right", 1, [frame, a], null, () => "x");
  expect([nodes[0].x, nodes[0].y]).toEqual([200, 0]);
});

test("neighbour: the connected shape in that direction; nothing there, nothing", () => {
  const a = box("a", 0, 0), b = box("b", 300, 0), c = box("c", 0, 300), far = box("far", -400, 0);
  const ab = { id: "ab", type: "arrow", x: 100, y: 30, points: [[0, 0], [200, 0]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" } };
  const ca = { id: "ca", type: "arrow", x: 50, y: 300, points: [[0, 0], [0, -240]], startBinding: { elementId: "c" }, endBinding: { elementId: "a" } };
  const els = [a, b, c, far, ab, ca];
  expect(neighbour(a, "right", els)?.id).toBe("b");
  expect(neighbour(a, "down", els)?.id).toBe("c");
  expect(neighbour(a, "left", els)).toBe(null); // "far" isn't connected
});
test("flowchart: arrows turn at right angles, out from the parent's edge, across halfway, in to the new shape's edge", () => {
  const a = box("a", 0, 0), { arrows } = flowchart(a, "right", 3, [a], null, (() => { let n = 0; return () => `n${++n}`; })());
  for (const ar of arrows) {
    const pts = ar.points;
    for (let i = 1; i < pts.length; i++) expect(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1]).toBe(true);
    expect([ar.x, ar.y]).toEqual([100, 30]); // the parent's right edge
  }
  expect(arrows[1].points).toEqual([[0, 0], [100, 0]]); // the middle one is straight
  expect(arrows[0].points).toEqual([[0, 0], [50, 0], [50, -160], [100, -160]]);
  // Excalidraw's elbow arrows, pinned to the edge middles, so the editor re-routes them when either shape moves
  expect(arrows[0]).toMatchObject({ elbowed: true, startBinding: { fixedPoint: [1, 0.5] }, endBinding: { fixedPoint: [0, 0.5] } });
});
