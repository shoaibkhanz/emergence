// Usage's chart geometry: pure, so bun can test it (charts.js draws with it).

// Monotone cubic segments through the points (Fritsch–Carlson, as d3's curveMonotoneX): smooth, and never above or
// below the points it joins, so a stacked layer can't cross the one under it. [[x, y]] -> [{c1, c2, to}].
export function monotone(pts) {
  const n = pts.length;
  if (n < 2) return [];
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  tan[n - 1] = m[n - 2];
  // end tangents are one-sided; clamp them like the inner ones so the first and last steps can't overshoot
  if (n > 2) { tan[0] = m[0] * tan[1] <= 0 ? 0 : Math.min(Math.abs(tan[0]), 3 * Math.abs(m[0])) * Math.sign(m[0]); tan[n - 1] = m[n - 2] * tan[n - 2] <= 0 ? 0 : tan[n - 1]; }
  return pts.slice(1).map((p, i) => ({ c1: [pts[i][0] + dx[i] / 3, pts[i][1] + (tan[i] * dx[i]) / 3], c2: [p[0] - dx[i] / 3, p[1] - (tan[i + 1] * dx[i]) / 3], to: p }));
}

// Harness layers, bottom first, of one bucket field: each layer's lower and upper edge per bucket. Harnesses with
// nothing in any bucket are left out.
export function stack(buckets, field, order) {
  const base = buckets.map(() => 0), out = [];
  for (const h of order) {
    const v = buckets.map((b) => b[field]?.[h] ?? 0);
    if (!v.some(Boolean)) continue;
    const lo = [...base];
    v.forEach((x, i) => { base[i] += x; });
    out.push({ h, lo, hi: [...base] });
  }
  return out;
}

// Axis i of n at value v (0..1) around (cx, cy) with radius r: axis 0 straight up, clockwise.
export function radarPoint(i, n, v, cx, cy, r) {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
}
