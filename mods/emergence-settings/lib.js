// What the settings page shows and writes, kept pure for bun test. Every setting is a shared value the mod that owns
// it already reads, so a switch here is the same as the one in that mod. Herdr's own Settings has fixed sections a
// mod can't add to (frame/ is the app's), hence a page of our own.
//   get: shared, known: knownAgents() by key ({claude: true}) or null while it loads.
// A row: {id, name, about?, on, writes: [[key, value], …] for the flip}; one that can't flip has a note, no writes.

const flip = (id, name, about, on, writes) => ({ id, name, about, on, writes });

// The side mod's resident copy publishes {names, supported} (shared side.supported): mods can't import each other,
// and the list grows as adapters land. A harness never switched is on; only supported ones are saved (side's
// withoutStale drops the rest).
function sideRows(get, known) {
  const offer = get("side.supported");
  if (!offer) return [];
  const choices = get("side.harnesses") ?? {}, { names, supported } = offer;
  return Object.entries(names).map(([h, name]) => {
    const id = `side.${h}`, on = !!known?.[h] && choices[h] !== false;
    const note = !known ? "…" : !supported.includes(h) ? "coming" : !known[h] ? "not installed" : null;
    if (note) return { id, name, on, note };
    const next = Object.fromEntries(Object.entries({ ...choices, [h]: !on }).filter(([k]) => supported.includes(k)));
    return flip(id, name, null, on, [["side.harnesses", next]]);
  });
}

export function sections(get, known) {
  const dots = get("sidebar.folded") === "dots", split = get("pr-review.split") === true, big = get("skills.big") === true;
  return [
    { title: "Sidebar", rows: [flip("sidebar.dots", "Fold to dots",
      "⌘B folds the sidebar to a square per space instead of a rail of avatars. ⌘⌥B steps through both.",
      dots, [["sidebar.folded", dots ? "rail" : "dots"]])] },
    { title: "PRs", rows: [flip("prs.split", "Side by side diffs",
      "The old line on the left, the new on the right. A narrow panel stays unified.",
      split, [["pr-review.split", !split]])] },
    { title: "Library", rows: [flip("skills.big", "Large skill window",
      "Skills open almost as big as the screen. Dragging its edge sets your own size until this changes.",
      big, [["skills.big", !big], ["skills.wsize", null]])] }, // the window's own size toggle clears it too
    { title: "Side chats", about: "The harnesses ⌘⌥/ opens a side chat for.", rows: sideRows(get, known),
      empty: "Shows once Side chats has loaded in the emergence layout." },
  ];
}

// The rows that flip, in drawn order: what ↑/↓ walk.
export const toggles = (secs) => secs.flatMap((s) => s.rows).filter((r) => r.writes);
