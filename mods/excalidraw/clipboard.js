// herdr-mods: copy and paste on the canvas. The clipboard holds Excalidraw's own clipboard JSON
// ({type: "excalidraw/clipboard", elements, files}), so shapes paste between drawings, between the panel and the big
// window, and into excalidraw.com and back. Pasted copies get fresh ids; text inside a shape, arrows' ends and groups
// are joined up among the copies (an arrow end that wasn't copied lets go). Plain text pastes as a text element.

const CLIP = "excalidraw/clipboard";
const seed = () => Math.floor(Math.random() * 2 ** 31);

// The selection, with the text inside its shapes, as clipboard text; null when nothing live is selected.
export function copyText(elements, selectedIds) {
  const live = elements.filter((e) => e && !e.isDeleted), want = new Set(selectedIds);
  const picked = live.filter((e) => want.has(e.id) || (e.type === "text" && e.containerId && want.has(e.containerId)));
  return picked.length ? JSON.stringify({ type: CLIP, elements: picked, files: {} }) : null;
}

// Clipboard text -> new elements centred on `at` (scene units). newId() makes an id; style.fontSize sizes pasted text.
export function pasted(text, at, newId, style = {}) {
  if (typeof text !== "string" || !text.trim()) return [];
  let doc = null;
  try { doc = JSON.parse(text); } catch { /* plain text */ }
  if (!doc || !Array.isArray(doc.elements) || (doc.type !== CLIP && doc.type !== "excalidraw")) return [plainText(text, at, newId(), style.fontSize ?? 20)];
  const els = doc.elements.filter((e) => e && e.id && e.type && !e.isDeleted);
  if (!els.length) return [];
  const ids = new Map(els.map((e) => [e.id, newId()])), groups = new Map();
  const group = (g) => groups.get(g) ?? groups.set(g, newId()).get(g);
  const xs = els.flatMap((e) => [e.x, e.x + (e.width ?? 0)]), ys = els.flatMap((e) => [e.y, e.y + (e.height ?? 0)]);
  const dx = at.x - (Math.min(...xs) + Math.max(...xs)) / 2, dy = at.y - (Math.min(...ys) + Math.max(...ys)) / 2;
  const end = (b) => (b && ids.has(b.elementId) ? { ...b, elementId: ids.get(b.elementId) } : null);
  return els.map((e) => ({
    ...e,
    id: ids.get(e.id), x: e.x + dx, y: e.y + dy,
    groupIds: (e.groupIds ?? []).map(group), frameId: null,
    ...(e.containerId !== undefined && { containerId: ids.get(e.containerId) ?? null }),
    ...(e.boundElements && { boundElements: e.boundElements.filter((b) => ids.has(b.id)).map((b) => ({ ...b, id: ids.get(b.id) })) }),
    ...("startBinding" in e && { startBinding: end(e.startBinding) }),
    ...("endBinding" in e && { endBinding: end(e.endBinding) }),
    seed: seed(), versionNonce: seed(), version: 1, updated: Date.now(), isDeleted: false,
  }));
}

// Text from another app, as a text element centred on `at` (width by the canvas's text metric: 0.55 em a character).
function plainText(text, at, id, size) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), w = Math.max(...lines.map((l) => l.length)) * size * 0.55, h = lines.length * size * 1.25;
  return { id, type: "text", x: at.x - w / 2, y: at.y - h / 2, width: w, height: h, text: lines.join("\n"), originalText: lines.join("\n"), fontSize: size,
    fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, autoResize: true, groupIds: [], boundElements: null,
    seed: seed(), versionNonce: seed(), version: 1, updated: Date.now(), isDeleted: false };
}
