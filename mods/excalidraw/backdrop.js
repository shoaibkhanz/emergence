// herdr-mods: the Agents graph's backdrop, copied from mods/agent-graph/lib.js (mods can't import each other);
// excalidraw.test.js fails until the two copies match.
// The canvas backdrop: Emergence settings' Background (shared agent-graph.pattern). backdrop() -> { gap, layers }, a
// layer being { alpha (times the Background strength), stroke? (a width, else filled), polys?, segs?, off? } in screen
// px (plus off, [x, y], when given), drawn in the text colour. A layer with a `key` has the same geometry whenever the
// key is the same (only `off` moves with the pan), so a renderer can build its path once and keep it. Grids move with the view; their gap follows the zoom, halved or
// doubled to stay near the style's own. cards: [{ x, y, w, h }] on screen, for the styles that answer to them.
export const PATTERNS = {
  none: {},
  sparse: { gap: 64, r: 1 }, // the default
  gravity: { gap: 36, r: 0.75, pull: true }, // dots lean toward the cards: dragging a card drags them
  fade: { gap: 36, r: 0.9, fade: true }, // dots brightest near the cards, fading with distance
  iso: { gap: 36, r: 0.75, iso: true }, // every other row shifted half a gap: a triangle lattice
  graph: { gap: 36, major: 4 }, // graph paper: faint lines, every 4th stronger
  topo: { rings: 5, step: 18 }, // contour lines of the distance to the nearest card: close cards share rings
};
const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const edgeOf = (c, x, y) => Math.hypot(Math.max(0, Math.abs(c.x + c.w / 2 - x) - c.w / 2), Math.max(0, Math.abs(c.y + c.h / 2 - y) - c.h / 2));

export function backdrop(style, W, H, z, vx, vy, cards = [], now, moving = false) {
  const p = PATTERNS[style] ?? PATTERNS.sparse;
  if (p.rings) return { gap: 0, layers: cards.length && z > 0 ? topo(p, z, cards, vx, vy, now, moving) : [] };
  if (!p.gap || !(z > 0)) return { gap: 0, layers: [] }; // no zoom yet (or a bad one): nothing, never a loop that can't end
  let gap = p.gap * z;
  while (gap < p.gap * 0.6) gap *= 2;
  while (gap > p.gap * 1.6) gap /= 2;
  const ox = ((vx % gap) + gap) % gap, oy = ((vy % gap) + gap) % gap, size = `${gap.toFixed(3)}:${Math.ceil(W)}x${Math.ceil(H)}`;
  if (p.major) { // lines, every major-th one (counted from the drawing's origin) stronger: the grid repeats every major gaps
    const span = gap * p.major, sx = (((vx % span) + span) % span) - span, sy = (((vy % span) + span) % span) - span;
    const minor = { alpha: 0.45, stroke: 1, segs: [], off: [sx, sy], key: `graph:minor:${size}` }, major = { alpha: 1, stroke: 1, segs: [], off: [sx, sy], key: `graph:major:${size}` };
    for (let i = 0, x = 0; x < W + 2 * span; x += gap, i++) (i % p.major === 0 ? major : minor).segs.push([x, 0, x, H + 2 * span]);
    for (let i = 0, y = 0; y < H + 2 * span; y += gap, i++) (i % p.major === 0 ? major : minor).segs.push([0, y, W + 2 * span, y]);
    return { gap, layers: [minor, major] };
  }
  if (!p.pull && !p.fade) { // plain dots: one tile of the grid, slid by the pan (iso rows repeat every two)
    const rowH = p.iso ? gap * Math.sqrt(3) / 2 : gap, spanY = p.iso ? 2 * rowH : rowH, polys = [];
    for (let y = 0, row = 0; y < H + 2 * spanY; y += rowH, row++) for (let x = row % 2 && p.iso ? gap / 2 : 0; x < W + 2 * gap; x += gap) polys.push(square(x, y, p.r));
    return { gap, layers: [{ alpha: 1, polys, off: [ox - gap, (((vy % spanY) + spanY) % spanY) - spanY], key: `${PATTERNS[style] ? style : "sparse"}:${size}` }] };
  }
  // the grid (gravity and fading dots: plain rows), then each card touches only the dots within its reach, so the
  // cost follows the cards' surroundings, not dots x cards
  const cols = Math.ceil((W + 2 * gap) / gap) + 1, rows = Math.ceil((H + 2 * gap) / gap) + 1, x0 = ox - gap, y0 = oy - gap;
  if (p.pull || p.fade) {
    const reach = p.fade ? 6 : 4, dist = new Float32Array(cols * rows).fill(Infinity), dx = new Float32Array(cols * rows), dy = new Float32Array(cols * rows);
    for (const c of cards) {
      const c0 = Math.max(0, Math.floor((c.x - reach * gap - x0) / gap)), c1 = Math.min(cols - 1, Math.ceil((c.x + c.w + reach * gap - x0) / gap));
      const r0 = Math.max(0, Math.floor((c.y - reach * gap - y0) / gap)), r1 = Math.min(rows - 1, Math.ceil((c.y + c.h + reach * gap - y0) / gap));
      for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) {
        const x = x0 + q * gap, y = y0 + r * gap, i = r * cols + q, e = edgeOf(c, x, y);
        if (e < dist[i]) dist[i] = e;
        if (p.pull) { // gravity: strongest at a card's edge, gone a few gaps out
          const ex = c.x + c.w / 2 - x, ey = c.y + c.h / 2 - y, d = Math.hypot(ex, ey) || 1, f = gap * 0.45 * Math.exp(-e / (gap * 1.1));
          dx[i] += (ex / d) * f; dy[i] += (ey / d) * f;
        }
      }
    }
    const dot = (r, q, ddx = 0, ddy = 0) => square(x0 + q * gap + ddx, y0 + r * gap + ddy, p.r);
    if (p.fade) { // four steps of brightness by distance from the nearest card's edge
      const steps = [1, 0.6, 0.35, 0.15].map((alpha) => ({ alpha, polys: [] }));
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const e = dist[r * cols + q];
        steps[e < gap * 1.5 ? 0 : e < gap * 3.5 ? 1 : e < gap * 6 ? 2 : 3].polys.push(dot(r, q));
      }
      return { gap, layers: steps.filter((l) => l.polys.length) };
    }
    const polys = []; // gravity: each dot leans toward the cards, at most half a gap
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const i = r * cols + q, k = Math.min(1, gap / 2 / (Math.hypot(dx[i], dy[i]) || 1));
      polys.push(dot(r, q, dx[i] * k, dy[i] * k));
    }
    return { gap, layers: [{ alpha: 1, polys }] };
  }
}

// Contour lines (marching squares on a CELL px lattice) of the distance to the nearest card's edge, at step, 2 step...
// Where cards sit closer than two rings apart their rings join into one outline around the group, as on a map.
// Distances are only worked out near the cards (a ring's reach), and the contours are kept relative to the view's pan
// and reused until a card moves or the zoom changes: a render gets about 50 ms, and this is the slow style.
const CELL = 14;
// For each corner pattern (tl tr br bl inside the level = 8 4 2 1): pairs of cell sides (0 top, 1 right, 2 bottom,
// 3 left) a contour crosses.
const MARCH = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]],
  [[3, 0]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
// While a card is dragged (the key changes every frame) the old rings are kept for TOPO_EVERY ms between redraws, and
// redrawn on a coarser lattice (CELL_MOVING) until it's let go, so the drag itself stays smooth; `now` (ms) turns the
// throttle on, `moving` the coarse lattice.
const TOPO_EVERY = 120, CELL_MOVING = 24;
let topoMemo = null;
function topo(p, z, cards, vx, vy, now, moving) {
  const rel = cards.map((c) => ({ x: c.x - vx, y: c.y - vy, w: c.w, h: c.h })), cell = moving ? CELL_MOVING : CELL;
  const key = JSON.stringify([p.rings, p.step, z, cell, rel.map((c) => [c.x, c.y, c.w, c.h].map(Math.round))]);
  const sameZoom = topoMemo?.z === z && topoMemo?.n === rel.length;
  if (topoMemo?.key !== key && !(now != null && moving && sameZoom && now - topoMemo.at < TOPO_EVERY))
    topoMemo = { key, z, n: rel.length, at: now ?? 0, layers: contours(p, z, rel, cell).map((l, k) => ({ ...l, key: `topo:${key}:${k}` })) };
  return topoMemo.layers.map((l) => ({ ...l, off: [vx, vy] })); // segs stay relative: the drawing adds the pan
}
function contours(p, z, cards, CELL) {
  const levels = Array.from({ length: p.rings }, (_, k) => (k + 1) * p.step * z), top = levels.at(-1), reach = top + CELL;
  const x0 = Math.floor((Math.min(...cards.map((c) => c.x)) - reach) / CELL) * CELL;
  const y0 = Math.floor((Math.min(...cards.map((c) => c.y)) - reach) / CELL) * CELL;
  const cols = Math.ceil((Math.max(...cards.map((c) => c.x + c.w)) + reach - x0) / CELL) + 1;
  const rows = Math.ceil((Math.max(...cards.map((c) => c.y + c.h)) + reach - y0) / CELL) + 1;
  const f = new Float32Array(cols * rows).fill(Infinity);
  for (const c of cards) { // each card only touches the cells within a ring's reach of it
    const c0 = Math.max(0, Math.floor((c.x - reach - x0) / CELL)), c1 = Math.min(cols - 1, Math.ceil((c.x + c.w + reach - x0) / CELL));
    const r0 = Math.max(0, Math.floor((c.y - reach - y0) / CELL)), r1 = Math.min(rows - 1, Math.ceil((c.y + c.h + reach - y0) / CELL));
    for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) {
      const d = edgeOf(c, x0 + q * CELL, y0 + r * CELL), i = r * cols + q;
      if (d < f[i]) f[i] = d;
    }
  }
  const layers = levels.map((_, k) => ({ alpha: 1 - (k / p.rings) * 0.8, stroke: 1, segs: [] }));
  for (let r = 0; r < rows - 1; r++) for (let q = 0; q < cols - 1; q++) {
    const i = r * cols + q, tl = f[i], tr = f[i + 1], br = f[i + cols + 1], bl = f[i + cols];
    const lo = Math.min(tl, tr, br, bl);
    if (lo >= top) continue; // nothing crosses here: most cells
    const hi = Math.max(tl, tr, br, bl), x = x0 + q * CELL, y = y0 + r * CELL;
    for (let k = 0; k < levels.length; k++) {
      const L = levels[k];
      if (L <= lo || L > hi) continue;
      const at = (a, b) => (b === Infinity ? 1 : a === Infinity ? 0 : (L - a) / (b - a));
      const side = (s) => s === 0 ? [x + at(tl, tr) * CELL, y] : s === 1 ? [x + CELL, y + at(tr, br) * CELL]
        : s === 2 ? [x + at(bl, br) * CELL, y + CELL] : [x, y + at(tl, bl) * CELL];
      for (const [a, b] of MARCH[(tl < L) * 8 + (tr < L) * 4 + (br < L) * 2 + (bl < L)]) layers[k].segs.push([...side(a), ...side(b)]);
    }
  }
  return layers;
}

// The film grain's strength: Emergence settings' Grain (shared agent-graph.filmGrain, percent, 0 to 25).
export const grainOpacity = (p) => (Number.isFinite(p) && p >= 0 && p <= 25 ? p : 10) / 100;

// The dot grid's strength: Emergence settings' Background dots (shared agent-graph.dots, percent, 0 to 25).
export const DOTS_DEFAULT = 25;
export const dotsAlpha = (p) => (Number.isFinite(p) && p >= 0 && p <= 25 ? p : DOTS_DEFAULT) / 100;
