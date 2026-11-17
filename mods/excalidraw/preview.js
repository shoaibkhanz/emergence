// herdr-mods: a drawing's preview in the library: its shapes as outlines in one neutral ink (it reads on light and dark
// windows alike), filled shapes lightly tinted, free text as a short line, words never drawn; fitted into w x h.
export const PREVIEW_INK = "#8b8b93";
const f = (n) => Math.round(n * 10) / 10;

export function previewSvg(elements, w = 144, h = 88) {
  const els = elements.filter((e) => e && !e.isDeleted && !(e.type === "text" && e.containerId));
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  if (!els.length) return `${open}</svg>`;
  const pts = (e) => (e.points?.length ? e.points.map(([px, py]) => [e.x + px, e.y + py]) : [[e.x, e.y], [e.x + (e.width ?? 0), e.y + (e.height ?? 0)]]);
  const all = els.flatMap(pts), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), bw = Math.max(1, Math.max(...xs) - x0), bh = Math.max(1, Math.max(...ys) - y0);
  const k = Math.min((w - 8) / bw, (h - 8) / bh, 2), ox = (w - bw * k) / 2, oy = (h - bh * k) / 2;
  const X = (x) => f(ox + (x - x0) * k), Y = (y) => f(oy + (y - y0) * k);
  const paint = (e) => `stroke="${PREVIEW_INK}" stroke-width="1" fill="${e.backgroundColor && e.backgroundColor !== "transparent" ? PREVIEW_INK : "none"}"${e.backgroundColor && e.backgroundColor !== "transparent" ? ' fill-opacity="0.25"' : ""}`;
  const shapes = els.map((e) => {
    const x = X(e.x), y = Y(e.y), ww = f((e.width ?? 0) * k), hh = f((e.height ?? 0) * k);
    if (e.type === "rectangle" || e.type === "image" || e.type === "frame") return `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${f(Math.min(4, ww / 4, hh / 4))}" ${paint(e)}/>`;
    if (e.type === "ellipse") return `<ellipse cx="${f(x + ww / 2)}" cy="${f(y + hh / 2)}" rx="${f(ww / 2)}" ry="${f(hh / 2)}" ${paint(e)}/>`;
    if (e.type === "diamond") return `<polygon points="${f(x + ww / 2)},${y} ${f(x + ww)},${f(y + hh / 2)} ${f(x + ww / 2)},${f(y + hh)} ${x},${f(y + hh / 2)}" ${paint(e)}/>`;
    if (e.type === "text") return `<line x1="${x}" y1="${f(y + hh / 2)}" x2="${f(x + Math.min(ww, 40))}" y2="${f(y + hh / 2)}" stroke="${PREVIEW_INK}" stroke-width="1.5"/>`;
    if (e.points?.length) return `<polyline points="${pts(e).map(([px, py]) => `${X(px)},${Y(py)}`).join(" ")}" stroke="${PREVIEW_INK}" stroke-width="1" fill="none"/>`;
    return "";
  });
  return `${open}${shapes.join("")}</svg>`;
}
