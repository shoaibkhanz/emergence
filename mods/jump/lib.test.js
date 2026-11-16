import { test, expect } from "bun:test";
import { jumpRows, rowKey, selected, step } from "./lib.js";

// The sidebar: Testing (repo app's main checkout, two sessions) with jump-a (a worktree space of app) nested under it,
// website, notes (a folder in /r/pi-notes), pi, demo (repo demo) with demo-x under it. Spaces come in an order where
// jump-a isn't next to Testing yet, so the nesting is Jump's own. app has four worktrees nothing has open.
const sp = (id, name) => ({ id, name, machine: null });
const S = { A: sp("sA", "Testing"), C: sp("sC", "website"), N: sp("sN", "notes"), B: sp("sB", "pi"), J: sp("sJ", "jump-a"),
  D: sp("sD", "demo"), X: sp("sX", "demo-x") };
const SPACES = [S.A, S.C, S.N, S.B, S.J, S.D, S.X];
const tab = (s, id, cwd, extra = {}) => ({ kind: "tab", s, tb: { id, name: s.name }, cwd, branch: "main", here: false, who: "Claude Code", ...extra });
const TABS = [
  tab(S.A, "t1", "/r/app", { here: true, state: "working" }), tab(S.A, "t5", "/r/app", { on: "Graph animation", state: "idle" }),
  tab(S.C, "t3", "/r/web"), tab(S.N, "t8", "/r/pi-notes"), tab(S.B, "t2", "/r/pi", { on: "Explore the repo", state: "idle" }),
  tab(S.J, "t6", "/r/app/.wt/a", { branch: "a", on: "Fix flaky test", state: "blocked" }), tab(S.D, "t4", "/r/demo"), tab(S.X, "t7", "/r/demo-x", { branch: "x" }),
];
const wt = (path, key, branch, main = false) => ({ path, key, branch, main, repo: key, machine: null, at: 0 });
const WTS = [wt("/r/app", "app", "main", true), wt("/r/app/.wt/a", "app", "a"), wt("/r/app/.wt/b", "app", "b"), wt("/r/app/.wt/c", "app", "c"),
  wt("/r/app/.wt/d", "app", "d"), wt("/r/app/.wt/e", "app", "e"), wt("/r/pi", "pi", "main", true), wt("/r/pi-notes", "notes", "main", true),
  wt("/r/web", "web", "main", true), wt("/r/demo", "demo", "main", true), wt("/r/demo-x", "demo", "x")];
const RECENT = ["t1", "t2", "t6", "t3"];
const pad = (r) => "  ".repeat(r.depth ?? 0);
const show = (r) => r.kind === "label" ? `# ${r.text}` : r.kind === "space" ? `${pad(r)}${r.dim ? "~" : ""}${r.s.name}${r.tab ? ` =${r.tab.tb.id}` : ""}`
  : r.kind === "tab" ? `${r.recent ? "r " : ""}${pad(r)}${r.dim ? "~" : ""}${r.tb.id}` : r.kind === "wt" ? `${pad(r)}⑂ ${r.branch}`
  : r.kind === "more" ? `${pad(r)}+${r.count}` : `${r.kind} ${r.branch ?? r.repo}`;
const jump = (query = "", more = {}) => jumpRows({ spaces: SPACES, tabs: TABS, wts: WTS, recent: RECENT, query, ...more });

test("jumpRows: Recent (the last three sessions, not where you are), then every space as the sidebar nests them", () => {
  const { rows, pick } = jump();
  expect(rows.map(show)).toEqual([
    "# Recent", "r t2", "r t6", "r t3", "# Spaces",
    "Testing", "  t1", "  t5", "  jump-a =t6", "  ⑂ b", "  ⑂ c", "  +2", // a space with one session is one row; worktrees past two fold
    "website =t3", "notes =t8", "pi =t2", "demo =t4", "  demo-x =t7"]);
  expect(rows[pick]).toMatchObject({ recent: true, tb: { id: "t2" } }); // ⌘E ↵ goes back to the session before this one
});

test("jumpRows: ⌘E ↵ then ⌘E ↵ again comes back", () => {
  const there = TABS.map((r) => ({ ...r, here: r.tb.id === "t2" }));
  const { rows, pick } = jumpRows({ spaces: SPACES, tabs: there, wts: WTS, recent: ["t2", "t1", "t6"], query: "" });
  expect(rows[pick].tb.id).toBe("t1");
});

test("jumpRows: folded worktrees open (expanded), archived ones show only while typing", () => {
  expect(jump("", { expanded: new Set(["app"]) }).rows.map(show).slice(9, 14)).toEqual(["  ⑂ b", "  ⑂ c", "  ⑂ d", "  ⑂ e", "website =t3"]);
  const archived = new Set([JSON.stringify([null, "/r/app/.wt/b"])]);
  expect(jump("", { archived }).rows.map(show).slice(9, 13)).toEqual(["  ⑂ c", "  ⑂ d", "  ⑂ e", "website =t3"]); // "+1" would save nothing
  expect(jump("b", { archived }).rows.map(show)).toContain("  ⑂ b");
});

test("jumpRows: typing keeps what matches with its parents (dimmed); state words find an agent that needs you", () => {
  expect(jump("needs you").rows.map(show)).toEqual(["~Testing", "  jump-a =t6"]);
  expect(jump("flaky").rows.map(show).filter((s) => !s.startsWith("new"))).toEqual(["~Testing", "  jump-a =t6"]);
});

test("jumpRows: a space's name keeps all it holds", () => {
  expect(jump("testing").rows.map(show).filter((s) => !s.startsWith("new")))
    .toEqual(["Testing", "  t1", "  t5", "  jump-a =t6", "  ⑂ b", "  ⑂ c", "  ⑂ d", "  ⑂ e"]);
});

test("jumpRows: a name match ranks above a path match, and is picked", () => {
  const { rows, pick } = jump("pi");
  expect(rows.map(show).filter((s) => !s.startsWith("new"))).toEqual(["pi =t2", "notes =t8"]); // notes only by its folder
  expect(rows[pick].s.name).toBe("pi");
});

test("jumpRows: how many spaces, and how many are shown", () => {
  expect(jump()).toMatchObject({ total: 7, shown: 7 });
  expect(jump("pi")).toMatchObject({ total: 7, shown: 2 });
});

test("jumpRows: a branch name nothing has offers a new worktree in your repo, last", () => {
  const { rows } = jump("fix-typo");
  expect(rows.map(show)).toEqual(["new fix-typo"]);
  expect(rows[0]).toMatchObject({ kind: "new", repo: "app", space: S.A, cwd: "/r/app" });
  expect(jump("c").rows.some((r) => r.kind === "new")).toBe(false); // c exists
});

test("jumpRows: a worktree of a repo no space is in gets its repo as the heading", () => {
  const rows = jumpRows({ spaces: SPACES, tabs: TABS, wts: [...WTS, wt("/r/lib", "lib", "dev", true), wt("/r/lib-dev", "lib", "dev2")], recent: RECENT, query: "dev" }).rows;
  expect(rows.map(show).slice(0, 3)).toEqual(["repo lib", "  ⑂ dev", "  ⑂ dev2"]);
});

test("step: ↑/↓ skip the section labels and repo headings", () => {
  const { rows } = jump();
  expect(rows[step(rows, 3, 1)].s.name).toBe("Testing"); // from the last recent row, past "# Spaces"
  expect(rows[step(rows, 5, -1)].tb.id).toBe("t3");
  expect(rows[step(rows, 1, -1)].s.name).toBe("demo-x"); // wraps, past "# Recent"
});

test("selected: the highlight follows its row when worktrees arrive late and shift the list", () => {
  const before = jumpRows({ spaces: SPACES, tabs: TABS, wts: [], recent: RECENT, query: "" });
  const after = jump();
  const web = rowKey(before.rows.find((r) => r.kind === "space" && r.s.name === "website"));
  expect(after.rows[selected(after, web)].s.name).toBe("website");
  expect(selected(after, null)).toBe(after.pick);
  expect(selected(after, "tab:gone")).toBe(after.pick);
});
