// tabs-plus' decisions, kept pure for bun test.

// How long a panel's "bring me along" (shared "panel.carry": { id, at }) stays good: long enough for the space switch
// it was set before to land, short enough that a later switch of yours isn't taken for it.
export const CARRY_MS = 2000;

// The side panel a space shows when you switch to it: the one it had (stored; closed if it never had one), unless the
// switch came from a panel (the Agents graph's jump to an agent), which then comes along. Only a panel this layout has.
export function panelOnSwitch({ stored, enabled, carry, now }) {
  const want = carry && now - carry.at <= CARRY_MS ? carry.id : stored ?? null;
  return enabled.includes(want) ? want : null;
}
