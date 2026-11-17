// herdr-mods: where a drawing opens. One place for the Excalidraw panel, its big window (⤢) and the library.
import { openOverlay, run, layout, readTextFile, writeTextFile, appHome } from "herdr";
import { OPEN, openRecord } from "./handoff.js";

// The layout's stack holding the Excalidraw block (the side panel), if it has one.
function panelStack() {
  const find = (n) => (n?.children?.some((c) => c.id === "excalidraw") ? n : n?.children?.map(find).find(Boolean));
  return find(layout());
}
// A drawing in the side panel (open.json, which the panel follows; shown if hidden). False when there's no panel.
export async function showInPanel(file) {
  const stack = panelStack();
  if (!stack?.id) return false;
  const path = OPEN(appHome()), was = await readTextFile(path).catch(() => null);
  await writeTextFile(path, openRecord(file), was).catch(() => {});
  run("layout.select", { stack: stack.id, child: "excalidraw" });
  run("layout.show", { id: "panel" });
  return true;
}
// A drawing big, in a movable window of its own (sized as the Agents window; Esc or its Esc chip closes it).
export const openWindow = (file) => openOverlay({ mod: "excalidraw", kind: "window", key: "excalidraw-big", width: 0.92, height: 0.88, props: { file, window: true } });
