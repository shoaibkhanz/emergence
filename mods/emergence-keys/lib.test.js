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
  const b = [{ section: "mod:side-chats", action: "inbox.focus", keys: "ctrl-k" }, { section: "mod:spaces-plus", action: "inbox.focus", keys: "ctrl-j" }];
  const all = Object.fromEntries(rows(b).flatMap(([, list]) => list).map(([k, w]) => [w, k]));
  expect(all["Spaces → Inbox"]).toBe("⌃J");
  expect(all["Side chats → Inbox"]).toBe("⌃K");
});

test("rows over the repo's keys.json: every sidebar move and the side chat key show their key", async () => {
  const keys = JSON.parse(await Bun.file(new URL("../../keys.json", import.meta.url)).text());
  const b = Object.entries(keys).flatMap(([section, map]) => Object.entries(map).map(([k, action]) => ({ section, action, keys: k })));
  const all = Object.fromEntries(rows(b).flatMap(([, list]) => list).map(([k, w]) => [w, k]));
  expect(all["Spaces → Inbox"]).toBe("⌃J");
  expect(all["Inbox → Side chats"]).toBe("⌃J");
  expect(all["Side chats → Ports"]).toBe("⌃J");
  expect(all["Ports → Side chats"]).toBe("⌃K");
  expect(all["Side chats → Inbox"]).toBe("⌃K");
  expect(all["Inbox → Spaces"]).toBe("⌃K");
  expect(all["Side chat: ask the focused agent something, in a copy beside it"]).toBe("⌘⌥/");
  expect(all["Inbox → Ports"]).toBeUndefined(); // Side chats sits between them now
});
