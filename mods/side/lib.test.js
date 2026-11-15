import { expect, test } from "bun:test";
import { harnessOf, decide, noticeFor, tabsOf, SLOTS, slotView, claim } from "./lib.js";

const installed = { claude: true, opencode: true, codex: true, pi: false, omp: true };
const supported = ["claude", "opencode"];

test("decide: not an agent, then choose, not installed, off, coming, open", () => {
  expect(decide(null, {}, installed, supported)).toEqual({ action: "notice", notice: { title: "Side chat works on an agent's pane" } });
  expect(decide("claude", null, installed, supported)).toEqual({ action: "choose" });
  expect(decide("pi", {}, installed, supported)).toEqual({ action: "notice", notice: { title: "pi isn't installed" } });
  expect(decide("claude", { claude: false }, installed, supported)).toEqual({
    action: "notice",
    notice: { title: "Side sessions are off for Claude Code", body: "Click to choose harnesses", action: { name: "side.harnesses" } },
  });
  expect(decide("codex", {}, installed, supported)).toEqual({ action: "notice", notice: { title: "Side chat for Codex is coming" } });
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

const T = (name, agent, state = "live") => ({ name, state, program: { agent } });
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
