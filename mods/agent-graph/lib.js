// Host-free logic: terminals + git facts -> tree, tree -> positioned nodes and edges.

export const RANK = { blocked: 0, done: 1, working: 2, idle: 3 };
const rank = (s) => RANK[s] ?? 3;
// order: finished sub-agents newest first, the history card after the running ones.
const byRank = (a, b) => a.rank - b.rank || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
const tail = (p, n = 1) => (p ?? "").split("/").filter(Boolean).slice(-n).join("/") || "/";

// A terminal title without its harness marks: leading status glyphs and a short prompt or name before
// one (pi's "π > ", "π ⁂"), then private-use glyphs (nerd-font icons) anywhere.
export const cleanTitle = (s) =>
  (s ?? "").replace(/^(?:[^\p{L}\p{N}\p{Ps}~/]+|\p{L}{1,2}\s*>\s*|\p{L}{1,2}\s+(?=[\p{S}\p{Co}\u2042]))+/u, "")
    .replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFF}]/gu, "").replace(/\s+/g, " ").trim();

// `git rev-parse --path-format=absolute --show-toplevel --git-common-dir --abbrev-ref HEAD` -> facts.
export function parseRevParse(stdout) {
  const [top, common, branch] = stdout.trim().split("\n");
  return top && common ? { top, common, branch: branch === "HEAD" ? null : branch ?? null } : null;
}

// `gh pr list --json ...` -> branch -> newest PR (highest number).
export function prsByBranch(list) {
  const m = new Map();
  for (const p of list) if (!m.has(p.headRefName) || m.get(p.headRefName).number < p.number) m.set(p.headRefName, p);
  return m;
}

// `glab mr list` JSON -> the PR fields prsByBranch and prChip read (GitLab has no review decision here).
const MR_STATE = { opened: "OPEN", merged: "MERGED", closed: "CLOSED", locked: "CLOSED" };
export const mrsAsPRs = (list) => list.map((m) => ({ number: m.iid, state: MR_STATE[m.state] ?? "OPEN", isDraft: Boolean(m.draft),
  headRefName: m.source_branch, title: m.title, url: m.web_url, reviewDecision: null }));

// The chip a worktree shows for its PR (or none).
export function prChip(pr) {
  if (!pr) return { state: "none", label: "No PR" };
  const state = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";
  const review = state === "open" ? { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "review" }[pr.reviewDecision] : null;
  return { state, review: review ?? null, number: pr.number, title: pr.title ?? "", label: `#${pr.number} ${state}${review ? ` · ${review}` : ""}` };
}

const repoName = (common) => (common.endsWith("/.git") ? tail(common.slice(0, -5)) : tail(common).replace(/\.git$/, ""));

/**
 * items: [{ id, parent, machine, cwd, status, agent, name, ... }]
 * git: (machine, cwd) -> { top, common, branch, ahead, behind } | null (not a repo)
 * prs: (machine, common) -> Map branch -> PR, or undefined while unknown
 * cursor: where the sidebar's keyboard is (sidebarCursor): { kind: "agent", id } an Inbox card, { kind: "space", id },
 *   { kind: "worktree", on, path } a worktree no space has open; null: the focused terminal (focused) is where you are.
 * subs: in-process sub-agents as items (subItems): children of their agent; Active only never drops one by itself, and
 *   a finished one never keeps its agent.
 * -> repos [{ id, kind, name, machine, rank, worktrees: [{ id, kind, top, branch, path, ahead, behind, pr, rank, here, agents: [item + rank + here + children] }] }]
 * here marks where you are (the graph rings it): an agent for an Inbox card or the focused terminal, the worktrees of a
 * space's agents, an unopened worktree's own. Active only still draws what the sidebar cursor marks, so its ring has a card.
 */
export function buildTree(items, git, prs, { activeOnly = false, cursor = null, focused = null, subs = [] } = {}) {
  const all = [...items, ...subs];
  const ids = new Set(all.map((i) => i.id));
  const kids = new Map();
  const nodes = all.map((i) => ({ ...i, children: [] }));
  for (const n of nodes) if (n.parent && ids.has(n.parent) && n.parent !== n.id) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)).push(n);
  const inSpace = (n) => cursor?.kind === "space" && n.space === cursor.id;
  const inproc = (n) => n.sub || n.history; // in-process sub-agents and their history card
  // Most urgent status in a subtree; Active only drops idle ones, but not the sidebar cursor's, a space's agents, or one
  // holding them (an idle child that survived was kept).
  const settle = (n) => {
    n.children = (kids.get(n.id) ?? []).map(settle).filter(Boolean).sort(byRank);
    n.rank = Math.min(rank(n.status), ...n.children.map((c) => c.rank));
    n.here = cursor ? cursor.kind === "agent" && n.id === cursor.id : n.id === focused;
    const kept = (cursor && n.here) || inSpace(n) || n.children.some((c) => c.rank === RANK.idle && !inproc(c));
    return activeOnly && n.rank === RANK.idle && !kept && !inproc(n) ? null : n;
  };
  const spaceIn = (a) => inSpace(a) || a.children.some(spaceIn);
  const worktreeHere = (w) => cursor?.kind === "space" ? w.agents.some(spaceIn)
    : cursor?.kind === "worktree" && w.top != null && w.top === cursor.path && (w.machine || null) === (cursor.on || null);
  const roots = nodes.filter((n) => !(n.parent && ids.has(n.parent) && n.parent !== n.id)).map(settle).filter(Boolean);

  const repos = new Map();
  for (const n of roots) {
    const g = git(n.machine, n.cwd);
    const rid = g ? `${n.machine ?? ""}|${g.common}` : `${n.machine ?? ""}|none`;
    const repo = repos.get(rid) ?? repos.set(rid, g
      ? { id: rid, kind: "repo", name: repoName(g.common), machine: n.machine, worktrees: new Map() }
      : { id: rid, kind: "none", name: "Not in git", machine: n.machine, worktrees: new Map() }).get(rid);
    const wid = `${n.machine ?? ""}|${g ? g.top : n.cwd ?? "?"}`;
    if (!repo.worktrees.has(wid)) {
      const list = g && prs(n.machine, g.common);
      repo.worktrees.set(wid, g
        ? { id: wid, kind: "worktree", machine: n.machine, top: g.top, branch: g.branch, name: g.branch ?? tail(g.top), path: tail(g.top, 2), ahead: g.ahead ?? 0, behind: g.behind ?? 0, pr: list ? prChip(g.branch && list.get(g.branch)) : null, agents: [] }
        : { id: wid, kind: "folder", machine: n.machine, branch: null, name: tail(n.cwd), path: n.cwd ?? "", pr: null, agents: [] });
    }
    repo.worktrees.get(wid).agents.push(n);
  }
  const out = [...repos.values()].map((r) => {
    const worktrees = [...r.worktrees.values()].map((w) => {
      w.agents.sort(byRank);
      w.rank = Math.min(...w.agents.map((a) => a.rank));
      w.here = worktreeHere(w);
      return w;
    }).sort(byRank);
    return { ...r, worktrees, rank: Math.min(...worktrees.map((w) => w.rank)) };
  });
  return out.sort((a, b) => a.rank - b.rank || (a.kind === "none") - (b.kind === "none") || a.name.localeCompare(b.name));
}

export const SIZE = { repo: { w: 200, h: 64 }, worktree: { w: 252, h: 64 }, agent: { w: 268, h: 64 } };
const GAP_X = 72, ROW = 76, REPO_GAP = 16;
const statusOf = (r) => Object.keys(RANK)[r] ?? "idle";

/**
 * Layered columns: repo | worktree | agent | sub-agent...; each leaf takes a row,
 * parents sit centred on their children. -> { nodes, edges, width, height }
 * nodes: { id, kind, x, y, w, h, data }; edges: { from, to, status, a: {x,y}, b: {x,y} } (right-mid -> left-mid).
 */
export function layout(repos) {
  const nodes = [], edges = [];
  const colX = (c) => (c === 0 ? 0 : c === 1 ? SIZE.repo.w + GAP_X : SIZE.repo.w + SIZE.worktree.w + 2 * GAP_X + (c - 2) * (SIZE.agent.w + GAP_X));
  let y = 0, right = 0;
  const place = (kind, data, col) => {
    const kids = kind === "repo" ? data.worktrees : kind === "worktree" ? data.agents : data.children;
    const placed = kids.map((c) => place(kind === "repo" ? "worktree" : "agent", c, col + 1));
    const s = SIZE[kind];
    const mid = (n) => n.y + n.h / 2;
    const cy = placed.length ? (mid(placed[0]) + mid(placed[placed.length - 1])) / 2 : y + s.h / 2;
    if (!placed.length) y += ROW;
    const n = { id: `${kind[0]}:${data.id}`, kind, x: colX(col), y: cy - s.h / 2, w: s.w, h: s.h, data };
    nodes.push(n);
    right = Math.max(right, n.x + n.w);
    for (const p of placed) edges.push({ from: n.id, to: p.id, status: statusOf(p.data.rank), a: { x: n.x + n.w, y: cy }, b: { x: p.x, y: mid(p) } });
    return n;
  };
  repos.forEach((r, i) => {
    if (i) y += REPO_GAP;
    place("repo", r, 0);
  });
  return { nodes, edges, width: right, height: Math.max(0, y - (ROW - SIZE.agent.h)) };
}

// Two theme colours (#rrggbb) blended, k of `b`: an opaque stand-in for `b` at alpha k over `a`.
export const mix = (a, b, k) => "#" + [1, 3, 5].map((i) =>
  Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");

// Inbox and Spaces each share their cursor (null without the keyboard); while it moves between them both can be
// set for a moment, and the newer one is where it went.
export const sidebarCursor = (inbox, spaces) => (inbox && spaces ? (inbox.at > spaces.at ? inbox : spaces) : inbox ?? spaces ?? null);

// How the panel opens, each time (nothing remembered): on Active when an agent works or needs you, else on All.
export const openOnActive = (items) => items.some((i) => i.agent && (i.status === "working" || i.status === "blocked"));

// While you're on All, the Active count lights when Active has something for you: "blocked" (an agent needs you) over
// "working", else null. Not armed once you've switched yourself while agents were active: All was your choice.
export function activeNudge(items, { onAll, armed }) {
  const agents = onAll && armed ? items.filter((i) => i.agent) : [];
  return agents.some((i) => i.status === "blocked") ? "blocked" : agents.some((i) => i.status === "working") ? "working" : null;
}

// The Active | All switch's counts: Active is what the Active view shows (every agent but the idle), All every agent.
export function filterCounts(items) {
  const agents = items.filter((i) => i.agent);
  return { active: agents.filter((i) => i.status !== "idle").length, all: agents.length };
}


// ---- In-process sub-agents: Claude Code's Task/Agent and omp's task (subagents.py reads their logs) ----

// What Herdr reports (an agent's OSC app name, or a program's key) -> subagents.py's harness (as mods/side lib.js).
const HARNESS = { "claude-code": "claude", claude: "claude", opencode: "opencode", codex: "codex", pi: "pi", omp: "omp" };
export const harnessOf = (app, programKey) => HARNESS[app] ?? HARNESS[programKey] ?? null;
const READ = ["claude", "omp"]; // pi, Codex, OpenCode: not read yet

// What subagents.py is asked about: this computer's claude and omp agents (remote machines: not yet), with their git top.
export const subRequests = (items, top) => items.filter((i) => !i.machine && i.agent && i.pid && READ.includes(i.harness))
  .map((i) => ({ address: i.id, pid: i.pid, harness: i.harness, top: top(i) }));

// subagents.py's agents (address -> { edited, subagents, ...metrics } | { error }) -> items for buildTree's subs:
// running ones work under their agent; finished ones are idle (never done: that's news only a terminal brings), under
// one history card per agent, newest first.
export const subItems = (items, scan) => items.flatMap((i) => {
  const all = scan?.[i.id]?.subagents ?? [], done = all.filter((s) => !s.running), hid = `${i.id}#~earlier`;
  const base = { owner: i.id, machine: i.machine, cwd: i.cwd, agent: true, program: i.program, tab: null, space: i.space ?? null };
  const card = (s, parent) => ({ ...base, id: `${i.id}#${s.id}`, parent, status: s.running ? "working" : "idle", name: s.title, sub: s,
    m: own(s), order: s.running ? 0 : -(s.finishedAt ?? s.updatedAt ?? 0) });
  return [...all.filter((s) => s.running).map((s) => card(s, i.id)),
    ...(done.length ? [{ ...base, id: hid, parent: i.id, status: "idle", name: `${done.length} earlier sub-agent${done.length > 1 ? "s" : ""}`,
      history: done.length, order: 1 }] : []),
    ...done.map((s) => card(s, hid))];
});

// The agents' own metrics from subagents.py, as m on their items.
export const metered = (items, scan) => items.map((i) => (scan?.[i.id] && !scan[i.id].error ? { ...i, m: own(scan[i.id]) } : i));

export const ago = (at, now) => { const m = Math.floor((now - at) / 60000); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

// A sub-agent card's state line.
export const subState = (s, now) => (s.running ? (s.action ? `Working · ${s.action}` : "Working") : `Finished ${ago(s.updatedAt, now)}`);

export const OVERLAP = 15 * 60000;

// Files two live writers (an agent, or a running sub-agent) both edited within OVERLAP and that are still uncommitted:
// path -> { rel, who: [ids] }. Same path, same worktree. Finished sub-agents are history, not writers.
export function overlaps(scan, now, window = OVERLAP) {
  const by = new Map();
  const add = (id, edited) => { for (const e of edited ?? []) if (e.dirty && now - e.at <= window) {
    const o = by.get(e.path) ?? by.set(e.path, { rel: e.rel ?? e.path, who: [] }).get(e.path);
    if (!o.who.includes(id)) o.who.push(id);
  } };
  for (const [address, a] of Object.entries(scan ?? {})) {
    add(address, a.edited);
    for (const s of a.subagents ?? []) if (s.running) add(`${address}#${s.id}`, s.edited);
  }
  return new Map([...by].filter(([, o]) => o.who.length > 1));
}

// The overlapping files any of `mine` (an id test) is writing.
export const conflictsOf = (ov, mine) => [...ov.values()].filter((o) => o.who.some(mine)).map((o) => o.rel);


// ---- Metrics: tool calls and cost, summed up the tree, and folding ----

// subagents.py's {tools, tokens, cost, costKind} -> a total that adds up: cost sums what has a price; unpriced: some
// tokens had none (the sum is then a floor); estimate: some of it is Claude at API prices on a subscription.
export const own = (x) => ({ tools: x?.tools ?? 0, tokens: x?.tokens ?? 0, cost: x?.cost ?? 0,
  unpriced: x?.cost == null && (x?.tokens ?? 0) > 0, estimate: x?.costKind === "estimate", agents: 0, subs: 0 });
const NONE = own(null);
export const addUp = (a, b) => ({ tools: a.tools + b.tools, tokens: a.tokens + b.tokens, cost: a.cost + b.cost,
  unpriced: a.unpriced || b.unpriced, estimate: a.estimate || b.estimate, agents: a.agents + b.agents, subs: a.subs + b.subs });

// "$0.42", "$12", "$1.2k", "$15k".
export const money = (x) => (x < 9.995 ? `$${x.toFixed(2)}` : x < 999.5 ? `$${Math.round(x)}` : x < 9950 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x / 1000)}k`);
// "980", "1.2k", "12k", "1.2M", "12M", "1.2B".
export const tokens = (n) => (n < 1000 ? String(n) : n < 9950 ? `${(n / 1e3).toFixed(1)}k` : n < 999500 ? `${Math.round(n / 1e3)}k`
  : n < 9.95e6 ? `${(n / 1e6).toFixed(1)}M` : n < 999.5e6 ? `${Math.round(n / 1e6)}M` : `${(n / 1e9).toFixed(1)}B`);
// "≈ $1.20" (an estimate), "$1.20", "$1.20+" (some had no price), "1.2M tok" (none had), "" (nothing yet).
export const costLabel = (t) => (t.cost > 0 || (!t.unpriced && t.tokens > 0)
  ? `${t.estimate ? "≈ " : ""}${money(t.cost)}${t.unpriced ? "+" : ""}` : t.tokens > 0 ? `${tokens(t.tokens)} tok` : "");
// A card's metrics: "⚒ 66 · ≈ $1.20".
export const metricLine = (t) => [t.tools ? `⚒ ${t.tools}` : "", costLabel(t)].filter(Boolean).join(" · ");
// What a folded card hides: "3 agents · 5 sub-agents · ≈ $14".
export const summary = (t) => [t.agents && `${t.agents} agent${t.agents > 1 ? "s" : ""}`, t.subs && `${t.subs} sub-agent${t.subs > 1 ? "s" : ""}`,
  costLabel(t)].filter(Boolean).join(" · ");

const under = (n) => n.agents ?? n.children ?? [];
// Folded or not: the person's choice (id -> true folded / false open), else history folds and live work stays open.
export const isFolded = (n, choices) => choices?.[n.id] ?? Boolean(n.history);
// Earlier sub-agents can be many: an opened history card folds again each time the panel opens. Other choices stay.
export const refold = (choices) => Object.fromEntries(Object.entries(choices).filter(([id, v]) => !(v === false && id.endsWith("#~earlier"))));

/**
 * repos (buildTree) -> the same tree with, on every worktree and agent card: total (its own metrics plus everything
 * under it, with agents and sub-agents counted), below (what's under it alone), foldable (something is), folded, ids. A
 * folded card's subtree is gone, so layout and the list draw it as a leaf with below on its chip.
 */
export function fold(repos, choices) {
  const walk = (n) => {
    const kids = under(n).map(walk);
    const self = { ...(n.m ?? NONE), agents: n.agent && !n.sub && !n.history ? 1 : 0, subs: n.sub ? 1 : 0 };
    const below = kids.reduce((t, k) => addUp(t, k.total), NONE);
    const foldable = kids.length > 0, folded = foldable && isFolded(n, choices);
    const shown = folded ? [] : kids;
    return { ...n, ...(n.agents ? { agents: shown } : { children: shown }), total: addUp(self, below), below, foldable, folded,
      ids: [n.id, ...kids.flatMap((k) => k.ids)] }; // its own and every id under it, folded or not (overlaps)
  };
  return repos.map((r) => ({ ...r, worktrees: r.worktrees.map(walk) }));
}

// Every card that folds, folded or not, from buildTree's tree (expand all / collapse all set them all).
export const foldables = (repos) => repos.flatMap((r) => r.worktrees.flatMap(function ids(n) {
  const kids = under(n);
  return kids.length ? [n.id, ...kids.flatMap(ids)] : [];
}));

// The graph's terminals: live ones, minus the side chat slots (layout block side-slots, mods/side). A side chat is in
// the sidebar's Side chats; here, a click on it would swap the panel the graph is in for the Side view.
export const graphTerminals = (terminals, sideSlots) => terminals.filter((x) => x.state === "live" && !sideSlots.includes(x.name));
