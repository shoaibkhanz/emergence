import { expect, test } from "bun:test";
import { harnessOf, decide, noticeFor, tabsOf, freeSlot, SLOTS } from "./lib.js";

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

test("freeSlot and tabsOf: six named slots, gaps reused, live ones as tabs", () => {
  expect(SLOTS).toEqual(["side-1", "side-2", "side-3", "side-4", "side-5", "side-6"]);
  expect(freeSlot([])).toBe("side-1");
  expect(freeSlot(["side-1", "side-3", "t5n"])).toBe("side-2");
  expect(freeSlot(SLOTS)).toBe(null);
  const saved = { "side-3": { harness: "claude", label: "Claude Code · herdr-mods" }, "side-9": { harness: "x", label: "gone" } };
  expect(tabsOf(["side-3", "side-1", "t5n"], saved)).toEqual([
    { slot: "side-1", harness: null, label: "side-1" },
    { slot: "side-3", harness: "claude", label: "Claude Code · herdr-mods" },
  ]);
});
