// herdr-mods: connecting shapes on the canvas. The dots on a hovered (or selected) shape's edges, where a press starts
// an arrow bound to it; ⌘+arrow's flowchart previews (Excalidraw's: copies of the shape GAP away, stacked and centred,
// clear of other shapes, each joined by a right-angle arrow); ⌥+arrow's connected neighbour. Elements come out partial:
// the editor's normalizeElement fills the rest (ids' seeds, versions, default styles).

export const GAP = 100; // Excalidraw's flowchart spacing (packages/element/src/flowchart.ts)
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const OPPOSITE = { up: "down", right: "left", down: "up", left: "right" };
const PIN = { up: [0.5, 0], right: [1, 0.5], down: [0.5, 1], left: [0, 0.5] }; // an elbow arrow's end, as a fraction of the shape
const centre = (e) => [e.x + e.width / 2, e.y + e.height / 2];

// The middle of each edge, in scene units.
export function edgeDots(e) {
  const [cx, cy] = centre(e);
  return [{ side: "up", x: cx, y: e.y }, { side: "right", x: e.x + e.width, y: cy }, { side: "down", x: cx, y: e.y + e.height }, { side: "left", x: e.x, y: cy }];
}
// The dot of one of these shapes within `reach` of point p, or null.
export function dotAt(shapes, p, reach) {
  for (const s of shapes) for (const d of edgeDots(s)) if (Math.hypot(d.x - p.x, d.y - p.y) <= reach) return { id: s.id, ...d };
  return null;
}

// --- ⌘+arrow: Excalidraw's flowchart (packages/element/src/flowchart.ts placeCluster, ported) ---
const mergeIntervals = (list) => [...list].sort((a, b) => a.start - b.start).reduce((out, it) => {
  const last = out[out.length - 1];
  if (last && it.start <= last.end) last.end = Math.max(last.end, it.end); else out.push({ ...it });
  return out;
}, []);
const isFree = (start, size, occupied) => occupied.every((o) => start + size <= o.start || start >= o.end);
const nearestFree = (ideal, size, occupied) => { // either side of ideal; a tie goes to the positive side
  if (isFree(ideal, size, occupied)) return ideal;
  const starts = [-Infinity, ...occupied.map((o) => o.end)], ends = [...occupied.map((o) => o.start), Infinity];
  let best = ideal, bestDistance = Infinity;
  for (let i = 0; i < starts.length; i++) {
    if (ends[i] - starts[i] < size) continue;
    const start = Math.min(Math.max(ideal, starts[i]), ends[i] - size), distance = Math.abs(start - ideal);
    if (distance <= bestDistance) { best = start; bestDistance = distance; }
  }
  return best;
};
// count equal nodes beside parent: a GAP away along the direction, centred on the parent across it, slid to the
// nearest free slot past the shapes in that band (kept a GAP clear); sticky: where a visible group started, so growing
// it keeps the nodes already shown in place unless it can centre again.
function placeCluster(parent, dir, count, obstacles, sticky) {
  const horizontal = dir === "left" || dir === "right", size = horizontal ? parent.width : parent.height, cross = horizontal ? parent.height : parent.width;
  const pStart = horizontal ? parent.x : parent.y, pCentre = horizontal ? parent.y + parent.height / 2 : parent.x + parent.width / 2;
  const primary = dir === "right" || dir === "down" ? pStart + size + GAP : pStart - GAP - size;
  const [zoneStart, zoneEnd] = dir === "right" || dir === "down" ? [pStart + size, primary + size + GAP] : [primary - GAP, pStart];
  const occupied = mergeIntervals(obstacles.filter((b) => (horizontal ? b[0] : b[1]) < zoneEnd - 1e-4 && (horizontal ? b[2] : b[3]) > zoneStart + 1e-4)
    .map((b) => ({ start: (horizontal ? b[1] : b[0]) - GAP, end: (horizontal ? b[3] : b[2]) + GAP })));
  const step = cross + GAP, total = count * cross + (count - 1) * GAP, centred = pCentre - total / 2;
  const anchored = sticky === null ? null : [centred, sticky, sticky - step].filter((st) => isFree(st, total, occupied))
    .sort((a, b) => Math.abs(a + total / 2 - pCentre) - Math.abs(b + total / 2 - pCentre))[0] ?? null;
  const crossStart = anchored ?? nearestFree(centred, total, occupied);
  return { crossStart, positions: Array.from({ length: count }, (_, i) => (horizontal ? { x: primary, y: crossStart + i * step } : { x: crossStart + i * step, y: primary })) };
}
const BLOCKS = new Set(["rectangle", "ellipse", "diamond", "image", "text"]);
const holds = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;

// ⌘+arrow, count presses that way: { nodes, arrows, source, crossStart } — copies of parent placed as Excalidraw does,
// an arrow bound from parent to each, and parent with those arrows bound. Every shape is in the way but parent, its
// words and a frame holding it.
export function flowchart(parent, dir, count, elements, sticky, newId) {
  const obstacles = elements.filter((e) => e && !e.isDeleted && e.id !== parent.id && BLOCKS.has(e.type) && !(e.type === "text" && e.containerId) && !holds(e, parent))
    .map((e) => [e.x, e.y, e.x + e.width, e.y + e.height]);
  const { positions, crossStart } = placeCluster(parent, dir, count, obstacles, sticky);
  const nodes = [], arrows = [];
  for (const at of positions) {
    const shapeId = newId(), arrowId = newId();
    const shape = { ...pick(parent), id: shapeId, x: at.x, y: at.y, width: parent.width, height: parent.height, boundElements: [{ id: arrowId, type: "arrow" }] };
    const from = edgeDots(parent).find((d) => d.side === dir), to = edgeDots(shape).find((d) => d.side === OPPOSITE[dir]), dx = to.x - from.x, dy = to.y - from.y;
    const horizontal = dir === "left" || dir === "right"; // out, across halfway, in: right angles, as Excalidraw's elbow arrows
    const points = (horizontal ? dy : dx) === 0 ? [[0, 0], [dx, dy]] : horizontal ? [[0, 0], [dx / 2, 0], [dx / 2, dy], [dx, dy]] : [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]];
    arrows.push({ id: arrowId, type: "arrow", x: from.x, y: from.y, width: Math.abs(dx), height: Math.abs(dy), points,
      strokeColor: parent.strokeColor, roughness: parent.roughness ?? 1, roundness: null,
      startBinding: { elementId: parent.id, focus: 0, gap: 4, fixedPoint: PIN[dir] }, endBinding: { elementId: shapeId, focus: 0, gap: 4, fixedPoint: PIN[OPPOSITE[dir]] },
      startArrowhead: null, endArrowhead: "arrow", elbowed: true, fixedSegments: null, startIsSpecial: null, endIsSpecial: null });
    nodes.push(shape);
  }
  return { nodes, arrows, crossStart, source: { ...parent, boundElements: [...(parent.boundElements ?? []), ...arrows.map((a) => ({ id: a.id, type: "arrow" }))] } };
}
const pick = (s) => ({ type: s.type, strokeColor: s.strokeColor, backgroundColor: s.backgroundColor, fillStyle: s.fillStyle, strokeWidth: s.strokeWidth,
  strokeStyle: s.strokeStyle, roughness: s.roughness, opacity: s.opacity ?? 100, roundness: s.roundness ?? null });

// ⌥+arrow: the shape joined to source by an arrow (either way) that lies most nearly in that direction, or null.
export function neighbour(source, dir, elements) {
  const byId = new Map(elements.map((e) => [e.id, e])), [sx, sy] = centre(source), [vx, vy] = STEP[dir];
  const joined = elements.filter((e) => e.type === "arrow" && !e.isDeleted).flatMap((a) => {
    const s = a.startBinding?.elementId, t = a.endBinding?.elementId;
    return s === source.id ? [t] : t === source.id ? [s] : [];
  }).map((id) => byId.get(id)).filter((e) => e && !e.isDeleted);
  let best = null, bestScore = Infinity;
  for (const e of joined) {
    const [ex, ey] = centre(e), dx = ex - sx, dy = ey - sy, along = dx * vx + dy * vy, across = Math.abs(dx * vy - dy * vx);
    if (along <= 0 || across > along) continue; // within 45° of the direction
    if (along + across < bestScore) { best = e; bestScore = along + across; }
  }
  return best;
}
