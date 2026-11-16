import { test, expect } from "bun:test";
import { jumpRows, rowKey, selected } from "./lib.js";

// Four spaces: Testing (you're here) and app-feat in repo app, pi and website in their own. login is a worktree of app
// nothing has open. Shown most recently: Testing, website, pi; app-feat never.
const sp = (id, name) => ({ id, name, machine: null });
const S = { A: sp("sA", "Testing"), B: sp("sB", "pi"), C: sp("sC", "website"), D: sp("sD", "app-feat") };
const tab = (s, id, cwd, here = false) => ({ kind: "tab", s, tb: { id, name: id }, cwd, branch: null, here, who: "Claude Code" });
const TABS = [tab(S.A, "t1", "/r/app", true), tab(S.B, "t2", "/r/pi"), tab(S.C, "t3", "/r/web"), tab(S.D, "t4", "/r/app/.wt/feat")];
const wt = (path, repo, key, branch) => ({ path, repo, key, branch, machine: null, at: 0 });
const WTS = [wt("/r/app", "app", "K1", "main"), wt("/r/app/.wt/feat", "app", "K1", "feat"), wt("/r/app/.wt/login", "app", "K1", "login"),
  wt("/r/pi", "pi", "K2", "main"), wt("/r/web", "web", "K3", "main")];
const RECENT = ["t1", "t3", "t2"];
const show = (r) => r.kind === "space" ? r.s.name : r.kind === "tab" ? `  ${r.tb.id}` : r.kind === "wt" ? `  ⑂ ${r.branch}` : `${r.kind} ${r.branch ?? r.repo}`;
const jump = (query = "") => jumpRows({ tabs: TABS, wts: WTS, recent: RECENT, query });

test("jumpRows: spaces with their sessions under them, where you are first, then by the session shown last", () => {
  const { rows, pick } = jump();
  expect(rows.map(show)).toEqual(["Testing", "  t1", "  ⑂ login", "website", "  t3", "pi", "  t2", "app-feat", "  t4"]);
  expect(rows[pick].tb.id).toBe("t3"); // ⌘E ↵ goes back to the session before this one, never a space
  expect(rows[0]).toMatchObject({ kind: "space", here: true, repo: "app", branch: "main" });
});

test("jumpRows: a repo's worktrees nothing has open sit under the space you were in last in that repo", () => {
  const away = TABS.map((r) => ({ ...r, here: r.tb.id === "t3" })); // you're in website; app-feat shown after Testing
  const rows = jumpRows({ tabs: away, wts: WTS, recent: ["t3", "t4", "t1"], query: "" }).rows.map(show);
  expect(rows.slice(0, 5)).toEqual(["website", "  t3", "app-feat", "  t4", "  ⑂ login"]);
});

test("jumpRows: typing keeps the spaces with a match, a space's name all its sessions", () => {
  expect(jump("pi").rows.map(show)).toEqual(["pi", "  t2", "new pi"]); // a word that could be a branch offers one, as before
  expect(jump("login").rows.map(show)).toEqual(["Testing", "  ⑂ login"]);
  expect(jump("/ web site").rows.map(show)).toEqual(["website", "  t3"]); // a leading "/" is ignored; every word
  expect(jump("zz zz").rows).toEqual([]);
});

test("jumpRows: a branch name nothing has offers a new worktree in your repo, last", () => {
  const { rows } = jump("fix-typo");
  expect(rows.map(show)).toEqual(["new fix-typo"]);
  expect(rows[0]).toMatchObject({ kind: "new", repo: "app", space: S.A, cwd: "/r/app" });
  expect(jump("login").rows.some((r) => r.kind === "new")).toBe(false); // login exists
});

test("jumpRows: a worktree of a repo no space is in gets its repo as the heading", () => {
  const rows = jumpRows({ tabs: TABS, wts: [...WTS, wt("/r/lib", "lib", "K9", "dev")], recent: RECENT, query: "dev" }).rows;
  expect(rows.map(show).slice(0, 2)).toEqual(["repo lib", "  ⑂ dev"]);
});

test("jumpRows: with only where you are, the pick is it", () => {
  const { rows, pick } = jumpRows({ tabs: [TABS[0]], wts: WTS, recent: RECENT, query: "" });
  expect(rows[pick].kind).toBe("tab");
});

test("jumpRows: ⌘E ↵ then ⌘E ↵ again comes back", () => {
  const there = TABS.map((r) => ({ ...r, here: r.tb.id === "t3" })); // went to website: tabs-plus put it first
  const { rows, pick } = jumpRows({ tabs: there, wts: WTS, recent: ["t3", "t1", "t2"], query: "" });
  expect(rows[pick].tb.id).toBe("t1");
});

test("selected: the pick follows its row when worktrees arrive late and shift the list", () => {
  const before = jumpRows({ tabs: TABS, wts: [], recent: RECENT, query: "" }); // worktrees not listed yet
  const after = jumpRows({ tabs: TABS, wts: WTS, recent: RECENT, query: "" }); // ⑂ login now sits under Testing
  expect(after.rows[selected(after, null)].tb.id).toBe("t3"); // nothing chosen yet: the pick, never a heading
  const chosen = rowKey(before.rows[before.pick]);
  expect(after.rows[selected(after, chosen)].tb.id).toBe("t3"); // the row, not its old position
  expect(selected(after, "tab:gone")).toBe(after.pick); // a row that's gone (filtered out): the pick
});
