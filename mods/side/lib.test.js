import { expect, test } from "bun:test";
import { harnessOf, decide, noticeFor, tabsOf, SLOTS, slotView, claim, bannerOf, withoutTab, INTRO, withoutStarting, withoutStale } from "./lib.js";

const installed = { claude: true, opencode: true, codex: true, pi: false, omp: true };
const supported = ["claude", "opencode"];

test("decide: not an agent, coming, then choose, not installed, off, open", () => {
  expect(decide(null, {}, installed, supported)).toEqual({ action: "notice", notice: { title: "Side chat works on an agent's pane" } });
  expect(decide("claude", null, installed, supported)).toEqual({ action: "choose" });
  expect(decide("opencode", {}, { ...installed, opencode: false }, supported)).toEqual({ action: "notice", notice: { title: "OpenCode isn't installed" } });
  expect(decide("claude", { claude: false }, installed, supported)).toEqual({
    action: "notice",
    notice: { title: "Side sessions are off for Claude Code", body: "Click to choose harnesses", action: { name: "side.harnesses" } },
  });
  expect(decide("codex", {}, installed, supported)).toEqual({ action: "notice", notice: { title: "Side chat for Codex is coming" } });
  // No adapter yet: "coming", never "off" (a leftover switch) and never the chooser, which can't help.
  expect(decide("omp", { omp: false }, installed, supported)).toEqual({ action: "notice", notice: { title: "Side chat for omp is coming" } });
  expect(decide("omp", null, installed, supported)).toEqual({ action: "notice", notice: { title: "Side chat for omp is coming" } });
  expect(decide("claude", { claude: true }, installed, supported)).toEqual({ action: "open" });
  expect(decide("opencode", {}, installed, supported)).toEqual({ action: "open" }); // installed and never switched: on
});

test("harnessOf: the agent's app, else the pane's program", () => {
  expect(harnessOf({ program: { key: "shell" } }, { app: "claude-code" })).toBe("claude");
  expect(harnessOf({ program: { key: "opencode", agent: true } }, undefined)).toBe("opencode");
  expect(harnessOf({ program: { key: "zsh", shell: true } }, undefined)).toBe(null);
  expect(harnessOf(null, undefined)).toBe(null);
});

test("noticeFor: a guess, a copy that can edit, not found, any other error", () => {
  const guess = { v: 1, session: { harness: "opencode", id: "s", cwd: "/w/margo" }, confidence: "guess" };
  expect(noticeFor(guess, "opencode")).toEqual({ title: "Copied the newest OpenCode session in margo" });
  expect(noticeFor({ v: 1, session: { cwd: "/w" }, confidence: "exact" }, "claude")).toBe(null);
  expect(noticeFor({ v: 1, launch: {}, note: "can-edit" }, "opencode")).toEqual({ title: "This copy can edit files" });
  expect(noticeFor({ v: 1, error: { code: "not-found", message: "x" } }, "claude")).toEqual({ title: "Couldn't find this Claude Code session" });
  expect(noticeFor({ v: 1, error: { code: "copy-failed", message: "HTTP 400" } }, "opencode")).toEqual({ title: "Side chat couldn't start", body: "HTTP 400" });
});

test("tabsOf: open slots in order, with what was saved about each", () => {
  expect(SLOTS).toEqual(["side-1", "side-2", "side-3", "side-4", "side-5", "side-6"]);
  const saved = { "side-3": { harness: "claude", label: "Claude Code · herdr-mods" } };
  expect(tabsOf(["side-3", "side-1"], saved)).toEqual([
    { slot: "side-1", harness: null, label: "side-1" },
    { slot: "side-3", harness: "claude", label: "Claude Code · herdr-mods" },
  ]);
});

// agent: a chat runs in it, so its host labels it side.chat=on (host.py mark) and Herdr sees the agent
const T = (name, agent, state = "live") => ({ name, state, program: { agent }, labels: agent ? { "side.chat": "on" } : {} });
const ALL = ["side-1", "side-2", "side-3", "side-4", "side-5", "side-6"];

test("slotView: open while an agent runs or just handed one; idle hosts; slots with no host; only the layout's slots", () => {
  const terminals = [T("side-1", true), T("side-2", false), T("side-3", false), T("side-4", true, "finished"), T("t5n", true)];
  const tabs = { "side-3": { at: 10000 }, "side-2": { at: 1 } }; // side-3 handed a chat 10s ago, side-2 long ago
  expect(slotView(terminals, ALL, tabs, 20000)).toEqual({
    open: ["side-1", "side-3"], idle: ["side-2"], missing: ["side-4", "side-5", "side-6"],
  });
  // a slot Herdr dropped from the layout is never offered
  expect(slotView([], ["side-2", "side-5"], {}, 0)).toEqual({ open: [], idle: [], missing: ["side-2", "side-5"] });
});

test("claim: reuse an idle host first, else start one in a slot with none, else nothing", () => {
  expect(claim({ open: ["side-1"], idle: ["side-3"], missing: ["side-2"] })).toEqual({ slot: "side-3", create: false });
  expect(claim({ open: ["side-1"], idle: [], missing: ["side-2", "side-4"] })).toEqual({ slot: "side-2", create: true });
  expect(claim({ open: ALL, idle: [], missing: [] })).toBe(null);
});

test("noticeFor: a guess with no folder doesn't say undefined", () => {
  expect(noticeFor({ v: 1, session: { cwd: null }, confidence: "guess" }, "opencode")).toEqual({ title: "Copied the newest OpenCode session" });
});

test("bannerOf: one short line, key words first, so a narrow panel never cuts 'nothing here reaches it'", () => {
  expect(bannerOf({ from: "feat/a-very-long-branch-name", label: "Claude Code · x" })).toBe("Has the agent's conversation · nothing here reaches it");
  expect(bannerOf(undefined)).toBe("Has the agent's conversation · nothing here reaches it");
});

test("withoutTab: a failed press leaves no pending tab behind (so the panel moves off the idle slot)", () => {
  const tabs = { "side-1": { at: 5 }, "side-2": { at: 6 } };
  expect(withoutTab(tabs, "side-1")).toEqual({ "side-2": { at: 6 } });
  expect(tabs["side-1"]).toEqual({ at: 5 }); // not mutated
  const v = slotView([{ name: "side-1", state: "live", program: null }], ["side-1"], withoutTab(tabs, "side-1"), 10);
  expect(v.open).toEqual([]);
});

test("INTRO: the slot's first line says the history is kept and the chat can carry on here", () => {
  expect(INTRO).toContain("conversation as background");
  expect(INTRO).toContain("Nothing you type here reaches the agent");
});

test("withoutStarting: a slot whose host was just started isn't offered again until it's live (or 10s pass)", () => {
  const v = { open: [], idle: [], missing: ["side-1", "side-2"] };
  expect(withoutStarting(v, { "side-1": 1000 }, 5000).missing).toEqual(["side-2"]);
  expect(withoutStarting(v, { "side-1": 1000 }, 12000).missing).toEqual(["side-1", "side-2"]);
  expect(claim(withoutStarting(v, { "side-1": 1000, "side-2": 1000 }, 2000))).toBe(null);
  expect(v.missing).toEqual(["side-1", "side-2"]); // not mutated
});

test("withoutStale: drops switches for harnesses without an adapter (nobody can flip those), keeps the rest", () => {
  expect(withoutStale({ claude: true, opencode: false, codex: true, pi: true, omp: false }, supported)).toEqual({ claude: true, opencode: false });
  expect(withoutStale(null, supported)).toBe(null);
});

test("slotView: only the host's side.chat label says a chat runs, never Herdr's leftover agent report", () => {
  // an omp chat ended; Herdr kept "omp idle", so the slot stayed a tab saying "Opening a side chat…" forever
  const ghost = { name: "side-1", state: "live", program: { agent: true }, labels: {} };
  expect(slotView([ghost], ["side-1"], {}, 99999)).toEqual({ open: [], idle: ["side-1"], missing: [] });
  // a harness Herdr doesn't recognise as an agent still counts while its host says a chat runs
  const unknown = { name: "side-2", state: "live", program: { agent: false }, labels: { "side.chat": "on" } };
  expect(slotView([unknown], ["side-2"], {}, 99999).open).toEqual(["side-2"]);
});
