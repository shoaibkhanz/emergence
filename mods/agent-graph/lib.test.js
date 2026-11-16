import { test, expect } from "bun:test";
import { buildTree, layout, prChip, prsByBranch, mrsAsPRs, parseRevParse, cleanTitle, SIZE, mix, sidebarCursor, openOnActive, filterCounts, activeNudge, graphTerminals,
  RANK, subItems, subState, ago, harnessOf, subRequests, overlaps, conflictsOf, metered, own, addUp, money, tokens, costLabel, metricLine,
  summary, fold, foldables, isFolded, refold, worktreeOwners, worktreeNote, GONE, detailRequest, detailHead, took, mdLines } from "./lib.js";

const GIT = {
  "/r/app": { top: "/r/app", common: "/r/app/.git", branch: "main" },
  "/r/app/src": { top: "/r/app", common: "/r/app/.git", branch: "main" },
  "/r/app/.wt/feat": { top: "/r/app/.wt/feat", common: "/r/app/.git", branch: "feat/x" },
  "/r/lib": { top: "/r/lib", common: "/r/lib/.git", branch: "dev" },
};
const git = (_m, cwd) => GIT[cwd] ?? null;
const PRS = prsByBranch([
  { number: 3, state: "OPEN", isDraft: false, headRefName: "feat/x", reviewDecision: "APPROVED" },
  { number: 1, state: "CLOSED", isDraft: false, headRefName: "feat/x" },
]);
const prs = (_m, common) => (common === "/r/app/.git" ? PRS : undefined);
const item = (id, cwd, status, parent = null) => ({ id, cwd, status, parent, machine: null, name: id });

test("worktrees sharing a common dir group under one repo; non-git under Not in git", () => {
  const tree = buildTree([item("t1", "/r/app", "idle"), item("t2", "/r/app/.wt/feat", "working"), item("t3", "/r/app/src", "idle"), item("t4", "/tmp", "idle")], git, prs);
  expect(tree.map((r) => r.name)).toEqual(["app", "Not in git"]);
  const app = tree[0];
  expect(app.worktrees.map((w) => w.branch)).toEqual(["feat/x", "main"]);
  expect(app.worktrees[1].agents.map((a) => a.id)).toEqual(["t1", "t3"]);
  expect(app.worktrees[0].pr).toEqual({ state: "open", review: "approved", number: 3, title: "", label: "#3 open · approved" });
  expect(app.worktrees[1].pr.state).toBe("none");
  expect(tree[1].worktrees[0]).toMatchObject({ kind: "folder", name: "tmp", pr: null });
});

test("sub-agents nest under their parent regardless of cwd; orphans become roots", () => {
  const tree = buildTree([item("t1", "/r/lib", "idle"), item("t2", "/tmp", "blocked", "t1"), item("t3", "/r/lib", "idle", "t2"), item("t4", "/r/lib", "done", "gone")], git, prs);
  expect(tree).toHaveLength(1);
  const [t1, t4] = tree[0].worktrees[0].agents;
  expect([t1.id, t4.id]).toEqual(["t1", "t4"]); // t1 carries its sub-agent's blocked
  expect(t1.children[0].id).toBe("t2");
  expect(t1.children[0].children[0].id).toBe("t3");
});

test("attention-first ordering: blocked > done > working > idle, propagated up", () => {
  const tree = buildTree([item("a", "/r/app", "idle"), item("b", "/r/app", "working"), item("c", "/r/app", "done"), item("d", "/r/lib", "blocked")], git, prs);
  expect(tree.map((r) => r.name)).toEqual(["lib", "app"]);
  expect(tree[1].worktrees[0].agents.map((a) => a.id)).toEqual(["c", "b", "a"]);
  expect(tree[1].rank).toBe(1);
});

test("active only drops idle leaves but keeps idle parents of active children", () => {
  const tree = buildTree([item("p", "/r/app", "idle"), item("k", "/r/app", "working", "p"), item("z", "/r/lib", "idle")], git, prs, { activeOnly: true });
  expect(tree.map((r) => r.name)).toEqual(["app"]);
  expect(tree[0].worktrees[0].agents[0].children.map((c) => c.id)).toEqual(["k"]);
});

test("layout: layered columns, parents centred on children, edges right-mid to left-mid", () => {
  const tree = buildTree([item("t1", "/r/app", "idle"), item("t2", "/r/app", "working"), item("s", "/r/app", "blocked", "t2")], git, prs);
  const L = layout(tree);
  const at = (id) => L.nodes.find((n) => n.id === id);
  const repo = at("r:|/r/app/.git"), wt = at("w:|/r/app"), t1 = at("a:t1"), t2 = at("a:t2"), s = at("a:s");
  expect([repo.x, wt.x, t2.x, s.x]).toEqual([0, SIZE.repo.w + 72, SIZE.repo.w + SIZE.worktree.w + 144, SIZE.repo.w + SIZE.worktree.w + SIZE.agent.w + 216]);
  expect(t2.y).toBe(s.y); // single child: same row
  expect(t2.y).toBeLessThan(t1.y); // blocked subtree first
  expect(wt.y + wt.h / 2).toBe((t2.y + t1.y) / 2 + SIZE.agent.h / 2);
  const e = L.edges.find((e) => e.to === "a:s");
  expect(e).toMatchObject({ from: "a:t2", status: "blocked", a: { x: t2.x + t2.w, y: t2.y + 32 }, b: { x: s.x, y: s.y + 32 } });
  expect(L.edges.find((e) => e.to === "a:t1").status).toBe("idle");
  expect(L.height).toBe(76 + 64);
});

test("parsers", () => {
  expect(parseRevParse("/r/app\n/r/app/.git\nHEAD\n")).toEqual({ top: "/r/app", common: "/r/app/.git", branch: null });
  expect(parseRevParse("")).toBeNull();
  expect(prChip({ number: 9, state: "OPEN", isDraft: true }).label).toBe("#9 draft");
  expect(prChip({ number: 9, state: "MERGED", reviewDecision: "APPROVED" }).label).toBe("#9 merged");
  expect(cleanTitle("π \u{F1049} HERDR:  Build  graph")).toBe("HERDR: Build graph");
  expect(cleanTitle("π > ⁂DOCS: Find")).toBe("DOCS: Find");
  expect(cleanTitle("✳ Claude Code")).toBe("Claude Code");
  expect(cleanTitle("AI is great")).toBe("AI is great");
  expect(cleanTitle("PR #42 fixes")).toBe("PR #42 fixes");
});

test("mrsAsPRs: GitLab MRs as the PRs prsByBranch and prChip read", () => {
  const m = prsByBranch(mrsAsPRs([
    { iid: 8, state: "opened", draft: false, source_branch: "feature/e2e", title: "Run page", web_url: "https://gitlab.com/x/y/-/merge_requests/8" },
    { iid: 3, state: "merged", draft: false, source_branch: "feature/e2e", title: "older", web_url: "u3" },
    { iid: 5, state: "opened", draft: true, source_branch: "wip", title: "W", web_url: "u5" },
  ]));
  expect(m.get("feature/e2e")).toMatchObject({ number: 8, state: "OPEN", isDraft: false, title: "Run page", url: "https://gitlab.com/x/y/-/merge_requests/8", reviewDecision: null });
  expect(prChip(m.get("feature/e2e")).label).toBe("#8 open");
  expect(prChip(m.get("wip")).state).toBe("draft");
});

test("mix blends two theme colours into an opaque one", () => {
  expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  expect(mix("#0e0e0e", "#ff0000", 0)).toBe("#0e0e0e");
  expect(mix("#102030ff", "#ffffff", 1)).toBe("#ffffff");
});

// The ring follows the level the sidebar's cursor is on, else the focused terminal.
const RING_ITEMS = [
  { id: "t1", cwd: "/r/app", status: "working", agent: true, name: "a", space: "s1" },
  { id: "t2", cwd: "/r/app/.wt/feat", status: "idle", agent: true, name: "b", space: "s2" },
  { id: "t3", parent: "t2", cwd: "/r/app/.wt/feat", status: "idle", agent: true, name: "c", space: "s2" },
];
// What the tree marks as where you are (here), by its own data: "agent <id>", "worktree <top>".
const hereOf = (tree) => tree.flatMap((r) => r.worktrees.flatMap((w) => [...(w.here ? [`worktree ${w.top}`] : []),
  ...w.agents.flatMap(function walk(a) { return [...(a.here ? [`agent ${a.id}`] : []), ...a.children.flatMap(walk)]; })]));
const ringTree = (cursor, focused = "t1", activeOnly = false) => buildTree(RING_ITEMS, git, () => undefined, { cursor, focused, activeOnly });
const shown = (tree) => tree.flatMap((r) => r.worktrees.flatMap((w) => w.agents.flatMap(function walk(a) { return [a.id, ...a.children.flatMap(walk)]; })));

test("here: no sidebar cursor marks the focused terminal's agent", () => {
  expect(hereOf(ringTree(null))).toEqual(["agent t1"]);
  expect(hereOf(ringTree(null, null))).toEqual([]);
});

test("here: an Inbox card marks its agent, not the focused one", () => {
  expect(hereOf(ringTree({ kind: "agent", id: "t3" }))).toEqual(["agent t3"]);
});

test("here: a space marks the worktree its agents work in, not an agent", () => {
  expect(hereOf(ringTree({ kind: "space", id: "s2" }))).toEqual(["worktree /r/app/.wt/feat"]);
});

test("here: an unopened worktree row marks that worktree", () => {
  expect(hereOf(ringTree({ kind: "worktree", on: null, path: "/r/app" }))).toEqual(["worktree /r/app"]);
  expect(hereOf(ringTree({ kind: "worktree", on: "", path: "/r/app" }))).toEqual(["worktree /r/app"]); // "" is this computer too
  expect(hereOf(ringTree({ kind: "worktree", on: "mini", path: "/r/app" }))).toEqual([]); // the same path on another machine
});

test("Active only still draws what's here (and what leads to it); nothing else idle", () => {
  expect(shown(ringTree(null, "t1", true))).toEqual(["t1"]);
  expect(shown(ringTree({ kind: "agent", id: "t3" }, "t1", true))).toEqual(["t1", "t2", "t3"]); // t2 holds its sub-agent t3
  expect(shown(ringTree({ kind: "space", id: "s2" }, "t1", true))).toEqual(["t1", "t2", "t3"]);
  expect(shown(ringTree({ kind: "worktree", on: null, path: "/r/app" }, "t1", true))).toEqual(["t1"]);
  expect(shown(ringTree(null, "t2", true))).toEqual(["t1"]); // Active only: the focused terminal's idle one stays hidden
});

test("sidebarCursor: whichever list holds the keyboard; the newer one while the keyboard moves between them", () => {
  const a = { kind: "agent", id: "t1", at: 5 }, s = { kind: "space", id: "s1", at: 9 };
  expect(sidebarCursor(null, null)).toBe(null);
  expect(sidebarCursor(a, null)).toBe(a);
  expect(sidebarCursor(null, s)).toBe(s);
  expect(sidebarCursor(a, s)).toBe(s);
});

// The Agents panel opens on Active when anything works or needs you, else All; the switch counts what each shows.
const FILTER_ITEMS = [
  { id: "a", agent: true, status: "working" }, { id: "b", agent: true, status: "idle" },
  { id: "c", agent: true, status: "done" }, { id: "t", agent: false, status: "idle" },
];

test("openOnActive: working or needs you opens on Active; finished, idle or no agents opens on All", () => {
  expect(openOnActive(FILTER_ITEMS)).toBe(true);
  expect(openOnActive([{ agent: true, status: "blocked" }])).toBe(true);
  expect(openOnActive([{ agent: true, status: "done" }, { agent: true, status: "idle" }])).toBe(false);
  expect(openOnActive([{ agent: false, status: "working" }])).toBe(false); // a plain terminal isn't an agent
  expect(openOnActive([])).toBe(false);
});

test("filterCounts: Active counts the agents Active shows (all but idle), All every agent", () => {
  expect(filterCounts(FILTER_ITEMS)).toEqual({ active: 2, all: 3 });
  expect(filterCounts([])).toEqual({ active: 0, all: 0 });
});

// On All, the Active count lights when there's something Active would show you: amber over blue, never once you've
// switched yourself (armed is false) or while you're on Active.
test("activeNudge: blocked beats working; nothing on Active, when disarmed, or with nothing active", () => {
  expect(activeNudge(FILTER_ITEMS, { onAll: true, armed: true })).toBe("working");
  expect(activeNudge([...FILTER_ITEMS, { agent: true, status: "blocked" }], { onAll: true, armed: true })).toBe("blocked");
  expect(activeNudge(FILTER_ITEMS, { onAll: false, armed: true })).toBe(null);
  expect(activeNudge(FILTER_ITEMS, { onAll: true, armed: false })).toBe(null);
  expect(activeNudge([{ agent: true, status: "done" }, { agent: false, status: "working" }], { onAll: true, armed: true })).toBe(null);
});

// In-process sub-agents (subagents.py's answer) hang off their agent as cards of their own.
const MIN = 60000, NOW = 1_790_000_000_000;
const SUB = (id, running, edited = [], extra = {}) => ({ id, title: `Task ${id}`, running, action: running ? "Run the tests" : null, edited, worktree: null,
  updatedAt: NOW - 4 * MIN, finishedAt: running ? null : NOW - 4 * MIN, tools: 0, tokens: 0, cost: null, costKind: null, ...extra });
const ed = (rel, ago, dirty = true) => ({ path: `/r/app/${rel}`, rel, at: NOW - ago * MIN, dirty });
const AGENTS = [
  { id: "t1", cwd: "/r/app", status: "idle", agent: true, name: "a", machine: null, program: { key: "claude" }, space: "s1" },
  { id: "t2", cwd: "/r/app", status: "working", agent: true, name: "b", machine: null },
];
const SCAN = { t1: { edited: [], subagents: [SUB("x", false), SUB("y", true, [ed("a.js", 1), ed("b.js", 2, false)])] } };
const subsOf = (tree, id) => tree.flatMap((r) => r.worktrees.flatMap((w) => w.agents)).find((a) => a.id === id)?.children ?? [];

test("subItems: running sub-agents under their agent, finished ones under its history card (never done)", () => {
  const subs = subItems(AGENTS, SCAN);
  expect(subs.map((s) => [s.id, s.parent, s.owner, s.status, s.name])).toEqual([["t1#y", "t1", "t1", "working", "Task y"],
    ["t1#~earlier", "t1", "t1", "idle", "1 earlier sub-agent"], ["t1#x", "t1#~earlier", "t1", "idle", "Task x"]]);
  expect(subs[2]).toMatchObject({ cwd: "/r/app", agent: true, program: { key: "claude" }, space: "s1" });
  expect(subs[1].history).toBe(1);
  expect(subItems(AGENTS, { gone: SCAN.t1, t2: { error: "boom" } })).toEqual([]); // not a live agent, or a failed read
});

test("buildTree: sub-agents under their agent, running first, then history; its working raises the agent's rank", () => {
  const tree = buildTree(AGENTS, git, prs, { subs: subItems(AGENTS, SCAN) });
  expect(subsOf(tree, "t1").map((c) => c.id)).toEqual(["t1#y", "t1#~earlier"]);
  expect(tree[0].worktrees[0].agents.find((a) => a.id === "t1").rank).toBe(RANK.working);
});

test("Active only: finished sub-agents stay under a shown agent but never keep an idle one", () => {
  const finished = { t1: { edited: [], subagents: [SUB("x", false)] } };
  expect(subsOf(buildTree(AGENTS, git, prs, { activeOnly: true, subs: subItems(AGENTS, finished) }), "t1")).toEqual([]); // t1 dropped
  const both = buildTree(AGENTS, git, prs, { activeOnly: true, subs: subItems(AGENTS, SCAN) });
  expect(subsOf(both, "t1").map((c) => c.id)).toEqual(["t1#y", "t1#~earlier"]);
  expect(subsOf(both, "t1")[1].children.map((c) => c.id)).toEqual(["t1#x"]);
  expect(filterCounts(AGENTS)).toEqual({ active: 1, all: 2 }); // counts are terminals' only
});

test("subState: what a sub-agent card's state line says", () => {
  expect(subState(SUB("y", true), NOW)).toBe("Working · Run the tests");
  expect(subState({ ...SUB("y", true), action: null }, NOW)).toBe("Working");
  expect(subState(SUB("x", false), NOW)).toBe("Finished 4m");
  expect(ago(NOW - 30000, NOW)).toBe("now");
  expect(ago(NOW - 2 * 3600000, NOW)).toBe("2h");
  expect(ago(NOW - 50 * 3600000, NOW)).toBe("2d");
});

test("harnessOf / subRequests: local claude and omp agents with a pid, with their git top", () => {
  expect([harnessOf("claude-code", null), harnessOf(null, "omp"), harnessOf(null, "nvim")]).toEqual(["claude", "omp", null]);
  const items = [
    { id: "t1", machine: null, agent: true, pid: 10, harness: "claude", cwd: "/r/app/src" },
    { id: "mini/t2", machine: "mini", agent: true, pid: 11, harness: "claude", cwd: "/r/app" }, // another machine: v1 skips
    { id: "t3", machine: null, agent: true, pid: 12, harness: "codex", cwd: "/r/app" },
    { id: "t4", machine: null, agent: true, pid: null, harness: "omp", cwd: "/r/app" },
  ];
  expect(subRequests(items, (i) => GIT[i.cwd]?.top ?? null)).toEqual([{ address: "t1", pid: 10, harness: "claude", top: "/r/app" }]);
});

test("overlaps: two live agents or running sub-agents with the same uncommitted file in 15 min", () => {
  const scan = {
    t1: { edited: [ed("a.js", 3)], subagents: [SUB("y", true, [ed("a.js", 1), ed("b.js", 2)]), SUB("z", true, [ed("c.js", 1, false)]), SUB("old", false, [ed("b.js", 1)])] },
    t2: { edited: [ed("b.js", 20), ed("c.js", 1, false), ed("d.js", 1)], subagents: [SUB("w", true, [ed("d.js", 5)])] },
    t3: { error: "boom" },
  };
  const ov = overlaps(scan, NOW);
  expect([...ov.keys()]).toEqual(["/r/app/a.js", "/r/app/d.js"]); // b.js: t2's edit is old, "old" finished; c.js committed
  expect(ov.get("/r/app/a.js")).toEqual({ rel: "a.js", who: ["t1", "t1#y"] });
  expect(ov.get("/r/app/d.js").who).toEqual(["t2", "t2#w"]);
  expect(conflictsOf(ov, (id) => id === "t2#w")).toEqual(["d.js"]);
  expect(conflictsOf(ov, (id) => id.startsWith("t1"))).toEqual(["a.js"]);
});

// Tool calls and cost: formatting, sums up the tree, history, folding.
test("money and tokens: short, and never more precise than they need to be", () => {
  expect([0.42, 3.4, 9.1, 12.4, 999.4, 1234, 15400].map(money)).toEqual(["$0.42", "$3.40", "$9.10", "$12", "$999", "$1.2k", "$15k"]);
  expect([980, 1234, 12000, 1_200_000, 42_564_925, 1_920_056_103].map(tokens)).toEqual(["980", "1.2k", "12k", "1.2M", "43M", "1.9B"]);
});

test("costLabel / metricLine: ≈ for an estimate anywhere in the sum, + when some had no price, tokens when none had", () => {
  const api = own({ tools: 66, tokens: 9e5, cost: 1.2, costKind: "api" }), est = own({ tools: 4, tokens: 1e5, cost: 0.3, costKind: "estimate" });
  const omp = own({ tools: 2, tokens: 10, cost: 0.05, costKind: "recorded" }), none = own({ tools: 3, tokens: 1_200_000, cost: null, costKind: null });
  expect(metricLine(api)).toBe("⚒ 66 · $1.20");
  expect(metricLine(addUp(api, est))).toBe("⚒ 70 · ≈ $1.50");
  expect(metricLine(addUp(api, omp))).toBe("⚒ 68 · $1.25");
  expect(metricLine(none)).toBe("⚒ 3 · 1.2M tok");
  expect(costLabel(addUp(api, none))).toBe("$1.20+");
  expect(metricLine(own({ tools: 0, tokens: 0, cost: null }))).toBe("");
  expect(costLabel(own({ tools: 1, tokens: 5, cost: 0, costKind: "recorded" }))).toBe("$0.00"); // priced at nothing is still a price
});

const METERED = {
  t1: { edited: [], tools: 10, tokens: 100, cost: 1, costKind: "estimate", subagents: [
    SUB("y", true, [], { tools: 5, tokens: 50, cost: 0.5, costKind: "estimate" }),
    SUB("old", false, [], { tools: 100, tokens: 10, cost: 4, costKind: "estimate", finishedAt: NOW - 60 * MIN }),
    SUB("new", false, [], { tools: 200, tokens: 20, cost: 5, costKind: "estimate", finishedAt: NOW - 10 * MIN }),
  ] },
  t2: { edited: [], subagents: [], tools: 3, tokens: 7, cost: null, costKind: null },
};
const meteredTree = (choices) => fold(buildTree(metered(AGENTS, METERED), git, prs, { subs: subItems(AGENTS, METERED) }), choices);
const agentOf = (tree, id) => tree[0].worktrees[0].agents.find((a) => a.id === id);

test("history: finished sub-agents newest first under one card; it folds by default, live work stays open", () => {
  const unfolded = buildTree(metered(AGENTS, METERED), git, prs, { subs: subItems(AGENTS, METERED) });
  const hist = subsOf(unfolded, "t1")[1];
  expect(hist.name).toBe("2 earlier sub-agents");
  expect(hist.children.map((c) => c.id)).toEqual(["t1#new", "t1#old"]);
  const t1 = agentOf(meteredTree({}), "t1");
  expect([t1.folded, t1.children.map((c) => [c.id, c.folded])]).toEqual([false, [["t1#y", false], ["t1#~earlier", true]]]);
  expect(t1.children[1].children).toEqual([]);
  expect(metricLine(t1.children[1].total)).toBe("⚒ 300 · ≈ $9.00"); // the history card's own line
  expect(isFolded({ id: "x", history: 2 }, { x: false })).toBe(false); // the person's choice wins
});

test("fold: totals sum each card and everything under it; worktrees count their agents and sub-agents", () => {
  const tree = meteredTree({});
  const t1 = agentOf(tree, "t1"), w = tree[0].worktrees[0];
  expect(t1.m.cost).toBe(1); // its own, for the card
  expect([t1.total.tools, t1.total.cost, t1.total.subs]).toEqual([315, 10.5, 3]); // with sub-agents, for the hover
  expect([w.total.agents, w.total.subs, w.total.tools, w.total.unpriced]).toEqual([2, 3, 318, true]); // t2 had no price
  expect(costLabel(w.total)).toBe("≈ $11+");
  expect(summary(w.below)).toBe("2 agents · 3 sub-agents · ≈ $11+");
  expect(summary(t1.below)).toBe("3 sub-agents · ≈ $9.50");
});

test("fold: a folded worktree or agent is a leaf (its summary rides on its card), so the graph narrows", () => {
  const w = "|/r/app";
  const tree = meteredTree({ [w]: true });
  expect(tree[0].worktrees[0]).toMatchObject({ folded: true, foldable: true, agents: [] });
  const L = layout(tree);
  expect(L.nodes.map((n) => n.id)).toEqual([`w:${w}`, "r:|/r/app/.git"]);
  expect(L.width).toBe(SIZE.repo.w + 72 + SIZE.worktree.w);
  expect(layout(meteredTree({ t1: true })).width).toBe(SIZE.repo.w + SIZE.worktree.w + SIZE.agent.w + 2 * 72); // fits a 620px panel
  const t1 = agentOf(meteredTree({ t1: true }), "t1");
  expect([t1.folded, t1.children]).toEqual([true, []]);
  expect(agentOf(meteredTree({ t1: true }), "t2").foldable).toBe(false); // nothing under it: no chevron
  expect(t1.ids).toEqual(["t1", "t1#y", "t1#~earlier", "t1#new", "t1#old"]); // a folded card still knows what's under it
  expect(tree[0].worktrees[0].ids).toContain("t1#old");
});

test("foldables: every card with something under it, inside folded ones too (expand all reaches them)", () => {
  const unfolded = buildTree(metered(AGENTS, METERED), git, prs, { subs: subItems(AGENTS, METERED) });
  expect(foldables(unfolded)).toEqual(["|/r/app", "t1", "t1#~earlier"]);
});

test("side chat slots stay out of the graph: clicking one would swap the panel to the Side view", () => {
  const ts = [{ name: "side-1", state: "live" }, { name: null, state: "live", address: "t1" }, { name: "x", state: "finished" }];
  expect(graphTerminals(ts, ["side-1", "side-2"])).toEqual([{ name: null, state: "live", address: "t1" }]);
  expect(graphTerminals(ts, []).length).toBe(2); // a layout without the Side view: nothing to leave out
});

test("refold: earlier sub-agents fold again each time the panel opens; other choices stay", () => {
  expect(refold({ "t1#~earlier": false, "t2#~earlier": true, t1: true, "|/r/app": false })).toEqual({ "t2#~earlier": true, t1: true, "|/r/app": false });
  expect(isFolded({ id: "t1#~earlier", history: true }, refold({ "t1#~earlier": false }))).toBe(true);
});

test("worktreeOwners: an isolated sub-agent's worktree names who works there, a running one first", () => {
  const items = [{ id: "t1", name: "Home", machine: null }, { id: "t9", name: "Remote", machine: "box" }];
  const sub = (owner, machine, title, worktree, running) => ({ owner, machine, name: title, sub: { worktree, running } });
  const subs = [sub("t1", null, "Old ticket", "/r/.claude/worktrees/a", false), sub("t1", null, "Ticket 2", "/r/.claude/worktrees/a", true),
    sub("t1", null, "In place", null, true), { owner: "t1", machine: null, id: "t1#~earlier", history: 1 }, sub("t9", "box", "Far", "/r/w", false)];
  const owners = worktreeOwners(items, subs);
  expect([...owners.keys()]).toEqual(["|/r/.claude/worktrees/a", "box|/r/w"]);
  expect(owners.get("|/r/.claude/worktrees/a")).toEqual({ agent: "Home", task: "Ticket 2", running: true });
  expect(owners.get("box|/r/w")).toEqual({ agent: "Remote", task: "Far", running: false });
});

test("a terminal whose folder was deleted (git: gone) draws no card; its worktree goes with it", () => {
  const gone = (_m, cwd) => (cwd === "/r/app/.wt/old" ? GONE : git(_m, cwd));
  const tree = buildTree([item("t1", "/r/app", "idle"), item("t2", "/r/app/.wt/old", "idle"), item("t3", "/r/app/.wt/old", "working", "t2")], gone, prs);
  expect(tree.map((r) => r.name)).toEqual(["app"]);
  expect(tree[0].worktrees.map((w) => w.top)).toEqual(["/r/app"]);
});

test("worktreeNote: where an isolated sub-agent worked, and whether that worktree is gone", () => {
  expect(worktreeNote(null, null)).toBe("");
  expect(worktreeNote("/r/app/.wt/feat", GIT["/r/app/.wt/feat"])).toBe(" in feat");
  expect(worktreeNote("/r/app/.wt/old", GONE)).toBe(" in old (worktree deleted)");
  expect(worktreeNote("/r/app/.wt/old", undefined)).toBe(" in old"); // not checked yet
});

test("detailRequest: a sub-agent card asks subagents.py about itself through its agent's pid; only local Claude for now", () => {
  const items = [{ id: "t1", pid: 42, harness: "claude", machine: null, cwd: "/r/app" }, { id: "t2", pid: 7, harness: "omp", machine: null, cwd: "/r/app" }];
  const card = (owner) => ({ id: `${owner}#a1`, owner, sub: { id: "a1" }, machine: null });
  expect(detailRequest(card("t1"), items, () => "/r/app")).toEqual({ pid: 42, harness: "claude", top: "/r/app", id: "a1" });
  expect(detailRequest(card("t2"), items, () => "/r/app")).toBeNull();
  expect(detailRequest({ id: "t1#~earlier", owner: "t1", history: 3 }, items, () => null)).toBeNull();
  expect(detailRequest(card("gone"), items, () => null)).toBeNull();
});

test("took and detailHead: the dialog's header facts", () => {
  expect([took(45_000), took(386_000), took(4_380_000), took(-5)]).toEqual(["45s", "6m 26s", "1h 13m", "0s"]);
  const d = { running: false, type: "Plan", model: "claude-fable-5-2", startedAt: 0, endedAt: 386_000, updatedAt: 386_000, tools: 15, tokens: 879_699, cost: 3.4177, costKind: "estimate" };
  expect(detailHead(d, 386_000 + 6 * 3_600_000)).toEqual({ state: "Finished 6h", facts: "Plan · fable-5-2 · ran 6m 26s", metrics: "⚒ 15 · 880k tokens · ≈ $3.42" });
  expect(detailHead({ ...d, running: true, model: null, type: null }, 400_000).facts).toBe("running 6m 40s");
});

test("mdLines: a report's markdown as plain lines a dialog can style (no inline markup)", () => {
  const md = "## What I found\n\nThe **graph** reads `items()`.\n- one\n  * two\n1. first\n```js\nconst **x** = 1;\n```\nend";
  expect(mdLines(md)).toEqual([
    { kind: "h", text: "What I found" }, { kind: "gap", text: "" }, { kind: "p", text: "The graph reads items()." },
    { kind: "li", text: "one", depth: 0 }, { kind: "li", text: "two", depth: 1 }, { kind: "p", text: "1. first" },
    { kind: "code", text: "const **x** = 1;" }, { kind: "p", text: "end" }]);
});
