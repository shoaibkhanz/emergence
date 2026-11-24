// Side sessions' decisions, kept pure for bun test: which harness a pane runs, what a key press does, what to tell
// the person, and the panel's six named terminal slots (layouts/emergence.json: side-slots).

import { SLOTS } from "./slots.js"; // shared/slots.js: slotView there is the sidebar's Side chats rule too

export const NAMES = { claude: "Claude Code", opencode: "OpenCode", codex: "Codex", pi: "pi", omp: "omp" };
// What Herdr reports (an agent's OSC app name, or a program's key) -> the helper's harness key.
const KEYS = { "claude-code": "claude", claude: "claude", opencode: "opencode", codex: "codex", pi: "pi", omp: "omp" };

export const harnessOf = (pane, agent) => KEYS[agent?.app] ?? KEYS[pane?.program?.key] ?? null;

// choices: the person's switches (shared "side.harnesses"), null before the first choice; a harness never switched
// is on. installed: knownAgents() by program key. supported: harnesses with an adapter.
export function decide(harness, choices, installed, supported) {
  const name = NAMES[harness];
  if (!harness) return { action: "notice", notice: { title: "Side chat works on an agent's pane" } };
  // No adapter yet: say so before anything a switch could change (the chooser shows it as "coming", no switch).
  if (!supported.includes(harness)) return { action: "notice", notice: { title: `Side chat for ${name} is coming` } };
  if (!choices) return { action: "choose" };
  if (!installed[harness]) return { action: "notice", notice: { title: `${name} isn't installed` } };
  if (choices[harness] === false) {
    // Herdr's palette doesn't list mod commands: clicking the notice is the way back to the switches.
    return { action: "notice", notice: { title: `Side sessions are off for ${name}`, body: "Click to choose harnesses", action: { name: "side.harnesses" } } };
  }
  return { action: "open" };
}

// The switches without harnesses that have no adapter: nobody can flip those (the chooser offers no switch), so a
// saved one is a leftover (the first chooser saved every harness, off where not yet installed) that would turn the
// harness off the day its adapter lands.
export const withoutStale = (choices, supported) =>
  choices && Object.fromEntries(Object.entries(choices).filter(([h]) => supported.includes(h)));

// A helper answer (locate's or copy's) -> what to tell the person, or null.
export function noticeFor(answer, harness) {
  const name = NAMES[harness];
  if (answer?.error) {
    return answer.error.code === "not-found" ? { title: `Couldn't find this ${name} session` }
      : { title: "Side chat couldn't start", body: answer.error.message };
  }
  if (answer?.confidence === "guess") {
    const folder = (answer.session?.cwd ?? "").split("/").filter(Boolean).pop();
    return { title: `Copied the newest ${name} session${folder ? ` in ${folder}` : ""}` };
  }
  if (answer?.note === "can-edit") return { title: "This copy can edit files" };
  return null;
}

// Tabs whose chat is now running, marked started (slotView then stops holding them open); null when none changed.
export function started(tabs, terminals) {
  const on = new Set(terminals.filter((t) => t.labels?.["side.chat"] === "on").map((t) => t.name));
  const fresh = Object.keys(tabs).filter((s) => on.has(s) && !tabs[s].started);
  return fresh.length ? { ...tabs, ...Object.fromEntries(fresh.map((s) => [s, { ...tabs[s], started: true }])) } : null;
}

// What the Side view does on a frame while it's showing: null (leave it), {show} an open chat (the slot shown has none),
// or {close}: "panel" when the chat you were watching ended by itself (as ✕ does), "slots" when the view was opened
// with no chat (its header's hint stays; the idle slot's "Opening a side chat…" goes). A hidden stack is left be: a
// chat's start hides and re-shows it (main.js start). watched: the shown slot was open on this view's last frame.
export function sideFrame({ open, active, hidden, watched }) {
  if (hidden || open.includes(active)) return null;
  if (open.length) return { show: open[0] };
  return { close: watched ? "panel" : "slots" };
}

// Where a new side chat goes: an idle host first, else a slot that needs one started; null when all six are open.
export function claim(view) {
  if (view.idle.length) return { slot: view.idle[0], create: false };
  return view.missing.length ? { slot: view.missing[0], create: true } : null;
}

// A host just started (hc run) may not be live in terminals() yet: leave its slot out of `missing` for a while, so
// it's never started twice. starting: {slot: when its start began}.
const STARTING_MS = 10000;
export const withoutStarting = (view, starting, now) =>
  ({ ...view, missing: view.missing.filter((s) => !(now - (starting[s] ?? -Infinity) < STARTING_MS)) });

// The open slots in order, each with what the panel saved about it (shared "side.tabs").
export const tabsOf = (open, saved) => SLOTS.filter((s) => open.includes(s))
  .map((slot) => ({ slot, harness: saved[slot]?.harness ?? null, label: saved[slot]?.label ?? slot }));

// A tabs object without one slot (a press that failed after its slot was shown, or a tab's ✕).
export const withoutTab = (tabs, slot) => Object.fromEntries(Object.entries(tabs).filter(([s]) => s !== slot));

// A side chat starts empty (the agent's history isn't replayed), so its slot's first line and the Side view's banner
// say it has that conversation as background and that nothing typed here reaches the agent.
export const INTRO = "  Side chat · it has this agent's conversation as background, so carry on here. Nothing you type here reaches the agent.";
// Claude clears the slot's intro line on its first draw, so the banner is the line that stays: short, key words first
// (which agent is in the tab's label and the sidebar's row; a long branch here would cut "nothing here reaches it").
export const bannerOf = () => "Has the agent's conversation · nothing here reaches it";
