// Side sessions' decisions, kept pure for bun test: which harness a pane runs, what a key press does, what to tell
// the person, and the panel's six named terminal slots (layouts/emergence.json: side-slots).

export const NAMES = { claude: "Claude Code", opencode: "OpenCode", codex: "Codex", pi: "pi", omp: "omp" };
export const SLOTS = ["side-1", "side-2", "side-3", "side-4", "side-5", "side-6"];
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

// The live side-N terminals are slot hosts (host.py) that never end: Herdr deletes a layout block whose terminal is
// finished, and emergence.json is the repo's. A slot is open while its host labels it side.chat=on (a chat runs), or for a moment after a chat
// was handed to it (tabs[slot].at, before the host has started it); idle while its host waits; missing with no host.
// Only slots the layout still has count.
const PENDING_MS = 15000;
export function slotView(terminals, layoutSlots, tabs, now) {
  const live = new Map(terminals.filter((t) => t.state === "live" && layoutSlots.includes(t.name)).map((t) => [t.name, t]));
  const ordered = SLOTS.filter((s) => layoutSlots.includes(s));
  // a chat runs while its host labels the slot (host.py mark), never by Herdr's agent report, which outlives an ended chat
  const chatting = (t) => t.labels?.["side.chat"] === "on";
  const open = ordered.filter((s) => live.has(s) && (chatting(live.get(s)) || now - (tabs[s]?.at ?? -Infinity) < PENDING_MS));
  return { open, idle: ordered.filter((s) => live.has(s) && !open.includes(s)), missing: ordered.filter((s) => !live.has(s)) };
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
