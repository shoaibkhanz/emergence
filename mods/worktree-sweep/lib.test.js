import { test, expect } from "bun:test";
import { step, tick, plan, tally, question, choices, onlyHereArgs } from "./lib.js";
import * as spaces from "../spaces-plus/lib.js";

const items = [{ key: "a", label: "a" }, { key: "b", label: "b" }, { key: "c", label: "c" }, { key: "d", label: "d" }];
const counts = { a: 0, b: 3, c: null }; // c: git couldn't tell; d: not known yet

test("step: ←/→ stop at the ends, Tab wraps", () => {
  expect(step(1, "left", 3)).toBe(0);
  expect(step(0, "left", 3)).toBe(0);
  expect(step(2, "right", 3)).toBe(2);
  expect(step(2, "tab", 3)).toBe(0);
  expect(step(1, "up", 3)).toBe(1);
});

test("tick: a new set with the key flipped, the old one untouched", () => {
  const one = new Set(["a"]);
  expect([...tick(one, "b")]).toEqual(["a", "b"]);
  expect([...tick(one, "a")]).toEqual([]);
  expect([...one]).toEqual(["a"]);
});

test("plan: clean ones go plainly; changed or unknown ones are skipped, or forced only when asked", () => {
  const all = new Set(["a", "b", "c", "d"]);
  expect(plan(items, all, counts, false)).toEqual({ remove: [{ ...items[0], force: false }], skip: [items[1], items[2], items[3]] });
  expect(plan(items, all, counts, true)).toEqual({
    remove: [{ ...items[0], force: false }, { ...items[1], force: true }, { ...items[2], force: true }, { ...items[3], force: true }], skip: [] });
  expect(plan(items, new Set(["b"]), counts, false)).toEqual({ remove: [], skip: [items[1]] });
});

test("tally: the line under the list", () => {
  expect(tally(items, new Set(), counts)).toBe("Nothing ticked");
  expect(tally(items, new Set(["a"]), counts)).toBe("1 ticked");
  expect(tally(items, new Set(["a", "b", "c"]), counts)).toBe("3 ticked · 2 with uncommitted changes");
});

test("question: how many go and how many have changes", () => {
  expect(question(2, 0)).toBe("Delete 2 worktrees? Their folders go; their branches stay.");
  expect(question(3, 1)).toBe("Delete 3 worktrees? 1 has uncommitted changes: Delete skips it.");
  expect(question(3, 2)).toBe("Delete 3 worktrees? 2 have uncommitted changes: Delete skips them.");
  expect(question(1, 1)).toBe("Delete 1 worktree? It has uncommitted changes.");
  expect(question(2, 2)).toBe("Delete 2 worktrees? All have uncommitted changes.");
});

test("choices: the confirm's buttons, the red one first and only with changes; Back is selected", () => {
  expect(choices(2, 0)).toEqual({ list: [["Back", "back"], ["Delete 2", "delete"]], sel: 0 });
  expect(choices(3, 1)).toEqual({ list: [["Delete permanently, including 1 with changes", "force"], ["Back", "back"], ["Delete 2 clean", "delete"]], sel: 1 });
  expect(choices(2, 2)).toEqual({ list: [["Delete permanently, including 2 with changes", "force"], ["Back", "back"]], sel: 1 });
});

test("commits only on a branch: the tally and the question say the branches keep them", () => {
  const items = [{ key: "a" }, { key: "b" }, { key: "c" }], counts = { a: 0, b: 0, c: 2 }, only = { a: 1, b: 0, c: 3 };
  expect(tally(items, new Set(["a", "b"]), counts, only)).toBe("2 ticked · 1 with commits only on its branch");
  expect(tally(items, new Set(["b"]), counts, only)).toBe("1 ticked");
  expect(question(2, 0, 1)).toBe("Delete 2 worktrees? Their folders go; their branches stay. 1 has commits only there.");
  expect(question(1, 0, 1)).toBe("Delete 1 worktree? Their folders go; their branches stay. It has commits only there.");
  expect(question(2, 0, 0)).toBe("Delete 2 worktrees? Their folders go; their branches stay.");
});

test("onlyHereArgs: the same git question as Spaces' (mods can't import each other)", () => {
  expect(onlyHereArgs("feat/x")).toEqual(spaces.onlyHereArgs("feat/x"));
  expect(onlyHereArgs(null)).toEqual(spaces.onlyHereArgs(null));
});
