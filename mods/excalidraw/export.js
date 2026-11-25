// herdr-mods: export a drawing as SVG or PNG (the bundled Excalidraw packages have no exporter: theirs needs a DOM).
// The canvas turns each element into pieces that emit into Herdr's PathBuilder (main.js elementItem); pathData
// records the same calls as SVG path data, so an export is exactly what the canvas draws. The PNG is made with macOS's
// own tools: qlmanage (WebKit, keeps the embedded Excalifont) renders the drawing centred in a square, and sips crops
// the centre back out (it crops centred only, and drops embedded fonts if asked to render the SVG itself).

const n = (v) => String(+(+v).toFixed(2));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A piece's emit(builder) -> SVG path data, through a recorder with the PathBuilder methods pieces use.
export function pathData(emit) {
  const d = [];
  const b = {
    move_to: (x, y) => (d.push(`M${n(x)} ${n(y)}`), b),
    line_to: (x, y) => (d.push(`L${n(x)} ${n(y)}`), b),
    cubic_bezier_to: (tx, ty, c1x, c1y, c2x, c2y) => (d.push(`C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(tx)} ${n(ty)}`), b),
    curve_to: (tx, ty, kx, ky) => (d.push(`Q${n(kx)} ${n(ky)} ${n(tx)} ${n(ty)}`), b),
    close: () => (d.push("Z"), b),
  };
  emit(b);
  return d.join(" ");
}

// "#rrggbb[aa]" -> { color: "#rrggbb", opacity }: an alpha in the colour isn't read by every SVG viewer.
export function splitColor(hex) {
  const a = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  return { color: hex.slice(0, 7), opacity: +a.toFixed(3) };
}

function pieceSvg(p) {
  const d = pathData(p.emit), { color, opacity } = splitColor(p.color), o = opacity < 1 ? opacity : null;
  if (p.fill) return `<path d="${d}" fill="${color}"${o ? ` fill-opacity="${o}"` : ""}/>`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(p.width)}"${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(" ")}"` : ""}`
    + `${o ? ` stroke-opacity="${o}"` : ""} stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Each line centred in its line box, as the canvas draws text (a row of line-height per line).
function textSvg(t) {
  const lh = t.fontSize * t.lineHeight, { color, opacity } = splitColor(t.color);
  const x = t.align === "center" ? t.x + t.w / 2 : t.align === "right" ? t.x + t.w : t.x;
  const anchor = t.align === "center" ? "middle" : t.align === "right" ? "end" : "start";
  return t.lines.map((line, i) => `<text x="${n(x)}" y="${n(t.y + i * lh + lh / 2)}" font-family="${esc(t.font)}" font-size="${n(t.fontSize)}" fill="${color}"`
    + `${opacity < 1 ? ` fill-opacity="${opacity}"` : ""}${anchor === "start" ? "" : ` text-anchor="${anchor}"`} dominant-baseline="central">${esc(line)}</text>`).join("");
}

// items: main.js elementItem's ({ bounds, pieces, texts, images }), in drawing order. font: Excalifont as base64,
// embedded when a text uses it. square: the drawing centred in a square viewBox (the PNG's render, cropped back).
// -> { svg, width, height, side }, width and height the drawing's (with pad), side the square's.
// ponytail: images inside a drawing are left out; embed them (base64 files) if drawings start carrying them.
export function toSvg(items, { background = "#ffffff", pad = 24, font = null, square = false } = {}) {
  const b = items.reduce((a, it) => [Math.min(a[0], it.bounds[0]), Math.min(a[1], it.bounds[1]), Math.max(a[2], it.bounds[2]), Math.max(a[3], it.bounds[3])],
    [Infinity, Infinity, -Infinity, -Infinity]);
  const [x0, y0] = items.length ? [b[0] - pad, b[1] - pad] : [0, 0];
  const width = items.length ? b[2] - b[0] + 2 * pad : 1, height = items.length ? b[3] - b[1] + 2 * pad : 1, side = Math.max(width, height);
  const box = square ? [x0 - (side - width) / 2, y0 - (side - height) / 2, side, side] : [x0, y0, width, height];
  const texts = items.flatMap((it) => it.texts);
  const style = font && texts.some((t) => t.font === "Excalifont")
    ? `<style>@font-face{font-family:"Excalifont";src:url(data:font/ttf;base64,${font}) format("truetype")}</style>` : "";
  const body = items.map((it) => it.pieces.map(pieceSvg).join("") + it.texts.map(textSvg).join("")).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(n).join(" ")}" width="${n(box[2])}" height="${n(box[3])}">${style}`
    + `<rect x="${n(x0)}" y="${n(y0)}" width="${n(width)}" height="${n(height)}" fill="${esc(background)}"/>${body}</svg>`;
  return { svg, width, height, side };
}

// Writes <name>.svg or .png to ~/Downloads (a mod writes only under its app home: the file is made in
// data/excalidraw/.exports and copied out) -> the path written. herdr: { exec, appHome, home, writeTextFile }, passed
// in by main.js so this file loads under bun test.
export async function saveExport(kind, items, { name, background }, { exec, appHome, home, writeTextFile }) {
  const run = async (cmd, args) => {
    const r = await exec(cmd, args, { timeout: 60000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `${cmd} failed`).trim().split("\n").pop());
    return r.stdout;
  };
  const writeOver = async (path, text) => { await run("rm", ["-f", path]); await writeTextFile(path, text, null); };
  const dir = `${appHome()}/data/excalidraw/.exports`, out = `${home()}/Downloads/${name}.${kind}`;
  await run("mkdir", ["-p", dir]);
  const font = items.some((it) => it.texts.some((t) => t.font === "Excalifont"))
    ? (await run("base64", ["-i", `${appHome()}/mods/excalidraw/fonts/Excalifont-Regular.ttf`])).replace(/\s+/g, "") : null;
  if (kind === "svg") {
    await writeOver(`${dir}/${name}.svg`, toSvg(items, { background, font }).svg);
    await run("cp", [`${dir}/${name}.svg`, out]);
    return out;
  }
  const { svg, width, height, side } = toSvg(items, { background, font, square: true });
  const size = Math.min(4096, Math.round(side * 2)), k = size / side, sq = `${dir}/${name}-square.svg`;
  await writeOver(sq, svg);
  await run("qlmanage", ["-t", "-s", String(size), "-o", dir, sq]);
  await run("sips", ["-c", String(Math.round(height * k)), String(Math.round(width * k)), `${sq}.png`, "--out", out]);
  return out;
}
