import { expect, test } from "bun:test";
import { statusOf, rowsOf, wantOf, holdsKeys } from "./lib.js";

const ALL = ["side-1", "side-2", "side-3", "side-4", "side-5", "side-6"];
const T = (name, agent, status = null, extra = {}) => ({ name, state: "live", status, program: { agent, key: agent ? "claude" : "program" },
  labels: agent ? { "side.chat": "on" } : {}, ...extra });

test("statusOf: working, blocked and done as they are; error needs you; anything else idle", () => {
  expect(["working", "blocked", "done"].map((s) => statusOf({ status: s }))).toEqual(["working", "blocked", "done"]);
  expect(statusOf({ status: "error" })).toBe("blocked");
  expect([{ status: "idle" }, { status: null }, { status: "x" }, {}].map(statusOf)).toEqual(["idle", "idle", "idle", "idle"]);
});

test("rowsOf: one row per open side chat, with its label, where it came from, status and program", () => {
  const terminals = [T("side-1", true, "working"), T("side-2", false), T("side-3", true, "blocked"), T("t5n", true, "working")];
  const tabs = { "side-1": { label: "Claude Code · herdr-mods", from: "feat/side-sessions", at: 1 }, "side-3": { label: "OpenCode · fastapi", from: "main", at: 1 } };
  expect(rowsOf(terminals, ALL, tabs, 100000)).toEqual([
    { slot: "side-1", label: "Claude Code · herdr-mods", from: "feat/side-sessions", status: "working", program: terminals[0].program },
    { slot: "side-3", label: "OpenCode · fastapi", from: "main", status: "blocked", program: terminals[2].program },
  ]);
});

test("rowsOf: pending slot (its host has the chat, the agent hasn't started yet) is a row, idle", () => {
  const rows = rowsOf([T("side-2", false)], ALL, { "side-2": { label: "Claude Code · margo", at: 99000 } }, 100000);
  expect(rows).toEqual([{ slot: "side-2", label: "Claude Code · margo", from: null, status: "idle", program: { agent: false, key: "program" } }]);
});

test("rowsOf: no tabs entry gives the slot as label and no from; slots the layout doesn't have are ignored", () => {
  expect(rowsOf([T("side-4", true, "working")], ALL, {}, 0)).toEqual([
    { slot: "side-4", label: "side-4", from: null, status: "working", program: { agent: true, key: "claude" } },
  ]);
  expect(rowsOf([T("side-4", true, "working")], ["side-1", "side-2"], {}, 0)).toEqual([]);
});

test("wantOf: one line when empty (the section always shows); header plus rows, at most four; nothing folded", () => {
  expect([wantOf(0, false), wantOf(2, false), wantOf(9, false), wantOf(3, true), wantOf(0, true)]).toEqual([32, 101, 161, 0, 0]);
});

test("holdsKeys: only a section with rows and an open sidebar can hold the keyboard", () => {
  expect([holdsKeys(2, false), holdsKeys(0, false), holdsKeys(2, true), holdsKeys(0, true)]).toEqual([true, false, false, false]);
});

test("rowsOf: a slot whose chat ended has no row, even with Herdr's leftover agent report", () => {
  expect(rowsOf([T("side-1", true, "idle", { labels: {} })], ALL, {}, 99999)).toEqual([]);
});
