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
  if (!choices) return { action: "choose" };
  if (!installed[harness]) return { action: "notice", notice: { title: `${name} isn't installed` } };
  if (choices[harness] === false) {
    // Herdr's palette doesn't list mod commands: clicking the notice is the way back to the switches.
    return { action: "notice", notice: { title: `Side sessions are off for ${name}`, body: "Click to choose harnesses", action: { name: "side.harnesses" } } };
  }
  if (!supported.includes(harness)) return { action: "notice", notice: { title: `Side chat for ${name} is coming` } };
  return { action: "open" };
}

// A helper answer (locate's or copy's) -> what to tell the person, or null.
export function noticeFor(answer, harness) {
  const name = NAMES[harness];
  if (answer?.error) {
    return answer.error.code === "not-found" ? { title: `Couldn't find this ${name} session` }
      : { title: "Side chat couldn't start", body: answer.error.message };
  }
  if (answer?.confidence === "guess") {
    return { title: `Copied the newest ${name} session in ${(answer.session?.cwd ?? "").split("/").filter(Boolean).pop()}` };
  }
  if (answer?.note === "can-edit") return { title: "This copy can edit files" };
  return null;
}

export const freeSlot = (live) => SLOTS.find((s) => !live.includes(s)) ?? null;

// The live slots in order, each with what the panel saved about it (localStorage "tabs").
export const tabsOf = (live, saved) => SLOTS.filter((s) => live.includes(s))
  .map((slot) => ({ slot, harness: saved[slot]?.harness ?? null, label: saved[slot]?.label ?? slot }));
