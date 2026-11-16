// What the settings page shows and writes, kept pure for bun test. Every setting is a shared value the mod that owns
// it already reads, so a switch here is the same as the one in that mod. Herdr's own Settings has fixed sections a
// mod can't add to (frame/ is the app's), hence a page of our own.
//   get: shared, known: knownAgents() by key ({claude: true}) or null while it loads.
// A row: {id, name, about?, on, writes: [[key, value], …] for the flip}; one that can't flip has a note, no writes.
// A choice: {id, name, about, kind: "choice", value, options: [{value, label, writes}]}.

// Emergence's dialog frame (RECIPE "Dialogs"); mods/dialogs.test.js holds every dialog's copy to it.
export const DIALOG = { pad: 24, gap: 16, title: 22, radius: 10, button: 32 };

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
    const note = !known ? "checking…" : !supported.includes(h) ? "coming" : !known[h] ? "not installed" : null;
    if (note) return { id, name, on, note };
    const next = Object.fromEntries(Object.entries({ ...choices, [h]: !on }).filter(([k]) => supported.includes(k)));
    return flip(id, name, null, on, [["side.harnesses", next]]);
  });
}

// How far back the Agents graph lists finished sub-agents, every harness alike. 30 days at most: Claude Code deletes
// its transcripts after that. Shown once agent-graph says it reads it (agent-graph.historyOffered).
const HISTORY = [[1, "1 day"], [7, "1 week"], [30, "30 days"]];
function historyRow(get) {
  const v = get("agent-graph.history"), value = HISTORY.some(([d]) => d === v) ? v : 30;
  return { id: "agents.history", name: "Sub-agent history", kind: "choice", value,
    about: "How far back Agents lists finished sub-agents (30 days at most).",
    options: HISTORY.map(([d, label]) => ({ value: d, label, writes: [["agent-graph.history", d]] })) };
}

export function sections(get, known) {
  const dots = get("sidebar.folded") === "dots", split = get("pr-review.split") === true, big = get("skills.big") === true;
  return [
    ...(get("agent-graph.historyOffered") ? [{ title: "Agents", rows: [historyRow(get)] }] : []),
    { title: "Sidebar", rows: [flip("sidebar.dots", "Fold to dots",
      "⌘B folds the sidebar to a square per space, not a rail of avatars (⌘⌥B steps).",
      dots, [["sidebar.folded", dots ? "rail" : "dots"]])] },
    { title: "PRs", rows: [flip("prs.split", "Side by side diffs",
      "Old on the left, new on the right; a narrow panel stays unified.",
      split, [["pr-review.split", !split]])] },
    { title: "Library", rows: [flip("skills.big", "Large skill window",
      "Skills open almost screen-sized; dragging an edge keeps your size.",
      big, [["skills.big", !big], ["skills.wsize", null]])] }, // the window's own size toggle clears it too
    { title: "Side chats", about: "The harnesses ⌘⌥/ opens a side chat for.", rows: sideRows(get, known),
      empty: "Shows once Side chats has loaded in the emergence layout." },
  ];
}

// The rows that flip, in drawn order: what ↑/↓ walk.
export const toggles = (secs) => secs.flatMap((s) => s.rows).filter((r) => r.writes || r.options);

// What a key does to a row: a switch flips; a choice steps by dir (←/→, stopping at its ends) or, with 0 (↵/space),
// goes round. -> writes ([] when nothing changes).
export function choose(r, dir) {
  if (!r.options) return r.writes ?? [];
  const i = r.options.findIndex((o) => o.value === r.value), n = r.options.length;
  const j = dir === 0 ? (i + 1) % n : Math.max(0, Math.min(n - 1, i + dir));
  return j === i ? [] : r.options[j].writes;
}
