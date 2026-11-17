// herdr-mods: the canvas's background (Emergence settings' Background, strength and Grain, shared with the Agents graph):
// the pure parts. cardsOf: the boxes a box-following pattern (fading dots, gravity, topographic) answers to, in screen
// px; alphaHex: the dot ink at a strength, as #rrggbbaa (null when it would round to nothing: never an invalid colour).

const BOXES = new Set(["rectangle", "ellipse", "diamond", "image"]);
const holds = (a, b) => a !== b && a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;

// scale: GPUI px per scene unit; scrollX/Y: the view's scroll (scene units). A rectangle around another box is a frame:
// it would light a whole region, so it sits out.
export function cardsOf(elements, scale, scrollX, scrollY) {
  const shapes = elements.filter((e) => e && !e.isDeleted && BOXES.has(e.type) && e.width > 0 && e.height > 0);
  return shapes.filter((e) => !(e.type === "rectangle" && shapes.some((o) => holds(e, o))))
    .map((e) => ({ x: (e.x + scrollX) * scale, y: (e.y + scrollY) * scale, w: e.width * scale, h: e.height * scale }));
}

export function alphaHex(color, alpha) {
  if (!/^#[0-9a-f]{6}/i.test(color ?? "")) return null;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return a < 1 ? null : `${color.slice(0, 7)}${a.toString(16).padStart(2, "0")}`;
}
