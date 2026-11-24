// The sidebar's Side chats section, decided here and tested with bun: one row per open side chat (mods/side), its
// status, and the height the section asks the inbox for (shared side-chats.want; mods/inbox lib.js splitColumn).

// Ports' row, header and empty-line heights, so the sections line up; at most four rows before the list scrolls.
export const HEADER_H = 41, ROW_H = 30, EMPTY_H = 32, MAX_ROWS = 4;

import { slotView } from "./slots.js"; // shared/slots.js: the panel's rule too

// A side chat terminal's status in the inbox's terms ("error" needs you, as the inbox's subAgents reads it).
export const statusOf = (t) => (["working", "blocked", "done"].includes(t?.status) ? t.status : t?.status === "error" ? "blocked" : "idle");

// The open side chats in slot order, each with what mods/side saved about it (shared side.tabs).
export function rowsOf(terminals, layoutSlots, tabs, now) {
  const byName = new Map(terminals.filter((t) => t.state === "live").map((t) => [t.name, t]));
  return slotView(terminals, layoutSlots, tabs, now).open.map((slot) => {
    const t = byName.get(slot);
    return { slot, label: tabs[slot]?.label ?? slot, from: tabs[slot]?.from ?? null, status: statusOf(t), program: t?.program ?? null };
  });
}

// Always there when the sidebar is open (one line with nothing open, as Ports' "none"), so it's found and nothing jumps.
export const wantOf = (n, folded) => (folded ? 0 : n ? HEADER_H + Math.min(n, MAX_ROWS) * ROW_H : EMPTY_H);

// Whether the section can hold the keyboard: with no rows or a folded sidebar it's 0px, and keys would go nowhere seen.
export const holdsKeys = (n, folded) => n > 0 && !folded;
