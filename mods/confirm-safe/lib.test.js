import { test, expect } from "bun:test";
import { shortPath, step } from "./lib.js";

test("shortPath: home as ~, long paths shortened in the middle, short ones whole", () => {
  expect(shortPath("/Users/me/code/x/wt", "/Users/me")).toBe("~/code/x/wt");
  expect(shortPath("/Users/me/.herdr/worktrees/emergence-sandbox/fix-unicode-names", "/Users/me")).toBe("~/.herdr/…/emergence-sandbox/fix-unicode-names");
  expect(shortPath("/private/tmp/claude-501/-Users-x/abc/scratchpad/gt/wt3", "/Users/me")).toBe("/private/…/gt/wt3");
  expect(shortPath("/Users/meta/x", "/Users/me")).toBe("/Users/meta/x");
});

test("step: ←/→ move along the buttons and stop at the ends, Tab wraps, other keys leave it", () => {
  expect(step(0, "right", 2)).toBe(1);
  expect(step(1, "right", 2)).toBe(1);
  expect(step(1, "left", 2)).toBe(0);
  expect(step(0, "left", 2)).toBe(0);
  expect(step(0, "tab", 2)).toBe(1);
  expect(step(1, "tab", 2)).toBe(0);
  expect(step(1, "left", 3)).toBe(0); // [Delete permanently] [Cancel] [Archive]: ← from Cancel
  expect(step(2, "tab", 3)).toBe(0);
  expect(step(1, "enter", 3)).toBe(1);
});
