import { test, expect } from "bun:test";
import { shortPath } from "./lib.js";

test("shortPath: home as ~, long paths shortened in the middle, short ones whole", () => {
  expect(shortPath("/Users/me/code/x/wt", "/Users/me")).toBe("~/code/x/wt");
  expect(shortPath("/Users/me/.herdr/worktrees/emergence-sandbox/fix-unicode-names", "/Users/me")).toBe("~/.herdr/…/emergence-sandbox/fix-unicode-names");
  expect(shortPath("/private/tmp/claude-501/-Users-x/abc/scratchpad/gt/wt3", "/Users/me")).toBe("/private/…/gt/wt3");
  expect(shortPath("/Users/meta/x", "/Users/me")).toBe("/Users/meta/x");
});
