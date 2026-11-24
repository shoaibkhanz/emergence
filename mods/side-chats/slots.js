// Side chats' slots and which of them are open: one rule for the Side panel (mods/side) and the sidebar's Side chats
// (mods/side-chats), so a row is never shown for a chat the panel counts as closed (a click on it would open and
// close the panel at once). Source of truth: shared/; copies are made by scripts/sync-shared.sh and checked in CI.

// The panel's six named terminal slots (layouts/emergence.json: side-slots).
export const SLOTS = ["side-1", "side-2", "side-3", "side-4", "side-5", "side-6"];

// The live side-N terminals are slot hosts (host.py) that never end: Herdr deletes a layout block whose terminal is
// finished, and emergence.json is the repo's. A slot is open while its host labels it side.chat=on (a chat runs), or
// for a moment after a chat was handed to it (tabs[slot].at, before the host has started it); idle while its host
// waits; missing with no host. Only slots the layout still has count.
const PENDING_MS = 15000;
export function slotView(terminals, layoutSlots, tabs, now) {
  const live = new Map(terminals.filter((t) => t.state === "live" && layoutSlots.includes(t.name)).map((t) => [t.name, t]));
  const ordered = SLOTS.filter((s) => layoutSlots.includes(s));
  // a chat runs while its host labels the slot (host.py mark), never by Herdr's agent report, which outlives an ended chat
  const chatting = (t) => t.labels?.["side.chat"] === "on";
  // the hand-over window covers only the wait for the chat to start: once seen running (started), its end is the end
  const handed = (s) => !tabs[s]?.started && now - (tabs[s]?.at ?? -Infinity) < PENDING_MS;
  const open = ordered.filter((s) => live.has(s) && (chatting(live.get(s)) || handed(s)));
  return { open, idle: ordered.filter((s) => live.has(s) && !open.includes(s)), missing: ordered.filter((s) => !live.has(s)) };
}
