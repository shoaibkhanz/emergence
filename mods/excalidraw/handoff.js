// herdr-mods: how agents (and the library-less picker) tell the Excalidraw panel what to show. The panel keeps
// <appHome>/data/excalidraw/open.json naming the drawing it has open; writing another path there opens that one.
// So an agent draws on what the user sees by editing that file (the panel reloads it), or starts a new drawing and
// points open.json at it. Only the panel copy reads or writes it.

export const DIR = (appHome) => `${appHome}/data/excalidraw`;
export const OPEN = (appHome) => `${DIR(appHome)}/open.json`;
const same = (a, b) => a === b || a === `/private${b}` || `/private${a}` === b;

// open.json's text -> the drawing it asks for, when that's a usable path other than the one open; else null.
export function requestedFile(text, current, home) {
  let file;
  try { file = JSON.parse(text)?.file; } catch { return null; }
  if (typeof file !== "string" || !file.trim()) return null;
  const path = file === "~" || file.startsWith("~/") ? home + file.slice(1) : file;
  if (!path.startsWith("/") || (current && same(path, current))) return null;
  return path;
}
export const openRecord = (file) => JSON.stringify({ file }, null, 1) + "\n";
