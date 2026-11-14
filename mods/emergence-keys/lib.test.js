import { test, expect } from "bun:test";
import { glyphs, rows } from "./lib.js";

test("glyphs: modifiers as symbols, keys upper-cased", () => {
  expect(glyphs("cmd-shift-a")).toBe("⌘⇧A");
  expect(glyphs("cmd-alt-b")).toBe("⌘⌥B");
  expect(glyphs("ctrl-j")).toBe("⌃J");
  expect(glyphs("cmd-shift-/")).toBe("⌘⇧/");
});

test("rows: bound keys from keys.json, unbound shows —, in-mod keys as written, filter", () => {
  const b = [{ action: "tabs-plus.graph", keys: "cmd-shift-a" }, { action: "spaces-plus.back", keys: "ctrl-l" }];
  const all = Object.fromEntries(rows(b).flatMap(([, list]) => list).map(([k, w]) => [w, k]));
  expect(all["Agents: every agent, its worktree and PR"]).toBe("⌘⇧A");
  expect(all["PRs: review pull requests and compare branches"]).toBe("—");
  expect(all["Find across the PR"]).toBe("⌘F");
  expect(all["Back to the terminal you came from"]).toBe("⌃L · Esc");
  expect(all["Move between panes and (n)vim splits (nav-keys, optional)"]).toBe("—");
  expect(rows(b, "archive")).toEqual([["Sidebar", [["→", "On a worktree: archive it (asks first; also on right-click)"]]]]);
});

test("rows: an action bound in several sections shows the binding from the section the row names", () => {
  const b = [{ section: "mod:ports", action: "inbox.focus", keys: "ctrl-k" }, { section: "mod:spaces-plus", action: "inbox.focus", keys: "ctrl-j" }];
  const all = Object.fromEntries(rows(b).flatMap(([, list]) => list).map(([k, w]) => [w, k]));
  expect(all["Spaces → Inbox"]).toBe("⌃J");
  expect(all["Ports → Inbox"]).toBe("⌃K");
});
