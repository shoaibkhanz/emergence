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
// git facts for a folder that no longer exists (a deleted worktree): its terminals draw no card.
export const GONE = Object.freeze({ gone: true });

// " in <worktree>" for an isolated sub-agent, marked once git finds its worktree deleted ("" without one).
export const worktreeNote = (path, facts) => (path ? ` in ${tail(path)}${facts?.gone ? " (worktree deleted)" : ""}` : "");

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
    if (g?.gone) continue;
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

// What subagents.py is asked about: this computer's claude and omp agents (remote machines: not yet), with their git top;
// and the agents that have ended (trackSessions), by the session remembered while they ran.
export const subRequests = (items, top, sessions = {}) => [
  ...items.filter((i) => !i.machine && i.agent && i.pid && READ.includes(i.harness)).map((i) => ({ address: i.id, pid: i.pid, harness: i.harness, top: top(i) })),
  ...Object.values(sessions).filter((e) => e.endedAt != null).map((e) => ({ address: `ended:${e.session}`, session: e.session, harness: e.harness, top: e.top ?? null, kind: e.kind ?? null })),
];

// The sessions of this computer's claude and omp agents (subagents.py gives each live one's), so an agent that ends
// keeps its sub-agents in the graph for the Sub-agent history window (endedItems). sessions: { id: { session, harness,
// address, cwd, top, name, program, space, kind, endedAt } }, endedAt null while it runs. A session no longer running
// gets endedAt now (its agent's scan failing once isn't an end: the agent is still there); one ended before `since`
// goes. -> { sessions, save }: save when one is new, ended or gone (shared agent-graph.ended), not for a title change.
export function trackSessions(prev, items, scan, top, now, since) {
  const live = new Map(items.filter((i) => !i.machine && i.agent && i.pid && READ.includes(i.harness)).map((i) => [i.id, i]));
  const sessions = {};
  let save = false;
  for (const [id, i] of live) {
    const s = scan?.[id]?.session;
    if (!s) continue;
    const was = prev[s];
    sessions[s] = { session: s, harness: i.harness, address: id, cwd: i.cwd, top: top(i) ?? was?.top ?? null, name: i.name, program: i.program ?? null,
      space: i.space ?? null, kind: scan[id].costKind ?? was?.kind ?? null, endedAt: null };
    if (!was || was.endedAt != null) save = true;
  }
  for (const [s, e] of Object.entries(prev)) {
    if (sessions[s]) continue;
    const running = e.endedAt == null && live.has(e.address) && !scan?.[e.address]?.session;
    const endedAt = e.endedAt ?? (running ? null : now);
    if (endedAt != null && endedAt < since) { save = true; continue; }
    sessions[s] = { ...e, endedAt };
    if (endedAt !== e.endedAt) save = true;
  }
  return { sessions, save };
}

// The agents that ended and still have sub-agents in the window: a quiet card each where it worked (its folder), with
// its sub-agents under it (subItems). No terminal: clicking folds it, its details open from its session.
export const endedItems = (sessions, scan, since) => Object.values(sessions ?? {})
  .filter((e) => e.endedAt != null && (scan?.[`ended:${e.session}`]?.subagents ?? []).some((x) => (x.finishedAt ?? x.updatedAt ?? 0) >= since))
  .map((e) => ({ id: `ended:${e.session}`, parent: null, machine: null, cwd: e.cwd, agent: true, ended: e.endedAt, session: e.session, top: e.top ?? null,
    harness: e.harness, program: e.program ?? null, status: "idle", name: `${e.name} · ended`, kind: null, tab: null, space: e.space ?? null, pid: null }));

// subagents.py's agents (address -> { edited, subagents, ...metrics } | { error }) -> items for buildTree's subs:
// running ones work under their agent; finished ones are idle (never done: that's news only a terminal brings), under
// one history card per agent, newest first.
// since: finished ones older than this (ms) drop out (historySince; the Sub-agent history setting).
export const subItems = (items, scan, since = 0) => items.flatMap((i) => {
  const all = (scan?.[i.id]?.subagents ?? []).filter((s) => s.running || (s.finishedAt ?? s.updatedAt ?? 0) >= since);
  const done = all.filter((s) => !s.running), hid = `${i.id}#~earlier`;
  const base = { owner: i.id, machine: i.machine, cwd: i.cwd, agent: true, program: i.program, tab: null, space: i.space ?? null };
  const card = (s, parent) => ({ ...base, id: `${i.id}#${s.id}`, parent, status: s.running ? "working" : "idle", name: s.title, sub: s,
    m: own(s), order: s.running ? 0 : -(s.finishedAt ?? s.updatedAt ?? 0) });
  return [...all.filter((s) => s.running).map((s) => card(s, i.id)),
    ...(done.length ? [{ ...base, id: hid, parent: i.id, status: "idle", name: `${done.length} earlier sub-agent${done.length > 1 ? "s" : ""}`,
      history: done.length, order: 1 }] : []),
    ...done.map((s) => card(s, hid))];
});

// The canvas backdrop: Emergence settings' Background (shared agent-graph.pattern). backdrop() -> { gap, layers }, a
// layer being { alpha (times the Background strength), stroke? (a width, else filled), polys?, segs?, off? } in screen
// px (plus off, [x, y], when given), drawn in the text colour. A layer with a `key` has the same geometry whenever the
// key is the same (only `off` moves with the pan), so a renderer can build its path once and keep it. Grids move with the view; their gap follows the zoom, halved or
// doubled to stay near the style's own. cards: [{ x, y, w, h }] on screen, for the styles that answer to them.
export const PATTERNS = {
  none: {},
  sparse: { gap: 64, r: 1 }, // the default
  gravity: { gap: 36, r: 0.75, pull: true }, // dots lean toward the cards: dragging a card drags them
  fade: { gap: 36, r: 0.9, fade: true }, // dots brightest near the cards, fading with distance
  iso: { gap: 36, r: 0.75, iso: true }, // every other row shifted half a gap: a triangle lattice
  graph: { gap: 36, major: 4 }, // graph paper: faint lines, every 4th stronger
  topo: { rings: 5, step: 18 }, // contour lines of the distance to the nearest card: close cards share rings
};
const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const edgeOf = (c, x, y) => Math.hypot(Math.max(0, Math.abs(c.x + c.w / 2 - x) - c.w / 2), Math.max(0, Math.abs(c.y + c.h / 2 - y) - c.h / 2));

export function backdrop(style, W, H, z, vx, vy, cards = [], now, moving = false) {
  const p = PATTERNS[style] ?? PATTERNS.sparse;
  if (p.rings) return { gap: 0, layers: cards.length && z > 0 ? topo(p, z, cards, vx, vy, now, moving) : [] };
  if (!p.gap || !(z > 0)) return { gap: 0, layers: [] }; // no zoom yet (or a bad one): nothing, never a loop that can't end
  let gap = p.gap * z;
  while (gap < p.gap * 0.6) gap *= 2;
  while (gap > p.gap * 1.6) gap /= 2;
  const ox = ((vx % gap) + gap) % gap, oy = ((vy % gap) + gap) % gap, size = `${gap.toFixed(3)}:${Math.ceil(W)}x${Math.ceil(H)}`;
  if (p.major) { // lines, every major-th one (counted from the drawing's origin) stronger: the grid repeats every major gaps
    const span = gap * p.major, sx = (((vx % span) + span) % span) - span, sy = (((vy % span) + span) % span) - span;
    const minor = { alpha: 0.45, stroke: 1, segs: [], off: [sx, sy], key: `graph:minor:${size}` }, major = { alpha: 1, stroke: 1, segs: [], off: [sx, sy], key: `graph:major:${size}` };
    for (let i = 0, x = 0; x < W + 2 * span; x += gap, i++) (i % p.major === 0 ? major : minor).segs.push([x, 0, x, H + 2 * span]);
    for (let i = 0, y = 0; y < H + 2 * span; y += gap, i++) (i % p.major === 0 ? major : minor).segs.push([0, y, W + 2 * span, y]);
    return { gap, layers: [minor, major] };
  }
  if (!p.pull && !p.fade) { // plain dots: one tile of the grid, slid by the pan (iso rows repeat every two)
    const rowH = p.iso ? gap * Math.sqrt(3) / 2 : gap, spanY = p.iso ? 2 * rowH : rowH, polys = [];
    for (let y = 0, row = 0; y < H + 2 * spanY; y += rowH, row++) for (let x = row % 2 && p.iso ? gap / 2 : 0; x < W + 2 * gap; x += gap) polys.push(square(x, y, p.r));
    return { gap, layers: [{ alpha: 1, polys, off: [ox - gap, (((vy % spanY) + spanY) % spanY) - spanY], key: `${PATTERNS[style] ? style : "sparse"}:${size}` }] };
  }
  // the grid (gravity and fading dots: plain rows), then each card touches only the dots within its reach, so the
  // cost follows the cards' surroundings, not dots x cards
  const cols = Math.ceil((W + 2 * gap) / gap) + 1, rows = Math.ceil((H + 2 * gap) / gap) + 1, x0 = ox - gap, y0 = oy - gap;
  if (p.pull || p.fade) {
    const reach = p.fade ? 6 : 4, dist = new Float32Array(cols * rows).fill(Infinity), dx = new Float32Array(cols * rows), dy = new Float32Array(cols * rows);
    for (const c of cards) {
      const c0 = Math.max(0, Math.floor((c.x - reach * gap - x0) / gap)), c1 = Math.min(cols - 1, Math.ceil((c.x + c.w + reach * gap - x0) / gap));
      const r0 = Math.max(0, Math.floor((c.y - reach * gap - y0) / gap)), r1 = Math.min(rows - 1, Math.ceil((c.y + c.h + reach * gap - y0) / gap));
      for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) {
        const x = x0 + q * gap, y = y0 + r * gap, i = r * cols + q, e = edgeOf(c, x, y);
        if (e < dist[i]) dist[i] = e;
        if (p.pull) { // gravity: strongest at a card's edge, gone a few gaps out
          const ex = c.x + c.w / 2 - x, ey = c.y + c.h / 2 - y, d = Math.hypot(ex, ey) || 1, f = gap * 0.45 * Math.exp(-e / (gap * 1.1));
          dx[i] += (ex / d) * f; dy[i] += (ey / d) * f;
        }
      }
    }
    const dot = (r, q, ddx = 0, ddy = 0) => square(x0 + q * gap + ddx, y0 + r * gap + ddy, p.r);
    if (p.fade) { // four steps of brightness by distance from the nearest card's edge
      const steps = [1, 0.6, 0.35, 0.15].map((alpha) => ({ alpha, polys: [] }));
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const e = dist[r * cols + q];
        steps[e < gap * 1.5 ? 0 : e < gap * 3.5 ? 1 : e < gap * 6 ? 2 : 3].polys.push(dot(r, q));
      }
      return { gap, layers: steps.filter((l) => l.polys.length) };
    }
    const polys = []; // gravity: each dot leans toward the cards, at most half a gap
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const i = r * cols + q, k = Math.min(1, gap / 2 / (Math.hypot(dx[i], dy[i]) || 1));
      polys.push(dot(r, q, dx[i] * k, dy[i] * k));
    }
    return { gap, layers: [{ alpha: 1, polys }] };
  }
}

// Contour lines (marching squares on a CELL px lattice) of the distance to the nearest card's edge, at step, 2 step...
// Where cards sit closer than two rings apart their rings join into one outline around the group, as on a map.
// Distances are only worked out near the cards (a ring's reach), and the contours are kept relative to the view's pan
// and reused until a card moves or the zoom changes: a render gets about 50 ms, and this is the slow style.
const CELL = 14;
// For each corner pattern (tl tr br bl inside the level = 8 4 2 1): pairs of cell sides (0 top, 1 right, 2 bottom,
// 3 left) a contour crosses.
const MARCH = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]],
  [[3, 0]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
// While a card is dragged (the key changes every frame) the old rings are kept for TOPO_EVERY ms between redraws, and
// redrawn on a coarser lattice (CELL_MOVING) until it's let go, so the drag itself stays smooth; `now` (ms) turns the
// throttle on, `moving` the coarse lattice.
const TOPO_EVERY = 120, CELL_MOVING = 24;
let topoMemo = null;
function topo(p, z, cards, vx, vy, now, moving) {
  const rel = cards.map((c) => ({ x: c.x - vx, y: c.y - vy, w: c.w, h: c.h })), cell = moving ? CELL_MOVING : CELL;
  const key = JSON.stringify([p.rings, p.step, z, cell, rel.map((c) => [c.x, c.y, c.w, c.h].map(Math.round))]);
  const sameZoom = topoMemo?.z === z && topoMemo?.n === rel.length;
  if (topoMemo?.key !== key && !(now != null && moving && sameZoom && now - topoMemo.at < TOPO_EVERY))
    topoMemo = { key, z, n: rel.length, at: now ?? 0, layers: contours(p, z, rel, cell).map((l, k) => ({ ...l, key: `topo:${key}:${k}` })) };
  return topoMemo.layers.map((l) => ({ ...l, off: [vx, vy] })); // segs stay relative: the drawing adds the pan
}
function contours(p, z, cards, CELL) {
  const levels = Array.from({ length: p.rings }, (_, k) => (k + 1) * p.step * z), top = levels.at(-1), reach = top + CELL;
  const x0 = Math.floor((Math.min(...cards.map((c) => c.x)) - reach) / CELL) * CELL;
  const y0 = Math.floor((Math.min(...cards.map((c) => c.y)) - reach) / CELL) * CELL;
  const cols = Math.ceil((Math.max(...cards.map((c) => c.x + c.w)) + reach - x0) / CELL) + 1;
  const rows = Math.ceil((Math.max(...cards.map((c) => c.y + c.h)) + reach - y0) / CELL) + 1;
  const f = new Float32Array(cols * rows).fill(Infinity);
  for (const c of cards) { // each card only touches the cells within a ring's reach of it
    const c0 = Math.max(0, Math.floor((c.x - reach - x0) / CELL)), c1 = Math.min(cols - 1, Math.ceil((c.x + c.w + reach - x0) / CELL));
    const r0 = Math.max(0, Math.floor((c.y - reach - y0) / CELL)), r1 = Math.min(rows - 1, Math.ceil((c.y + c.h + reach - y0) / CELL));
    for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) {
      const d = edgeOf(c, x0 + q * CELL, y0 + r * CELL), i = r * cols + q;
      if (d < f[i]) f[i] = d;
    }
  }
  const layers = levels.map((_, k) => ({ alpha: 1 - (k / p.rings) * 0.8, stroke: 1, segs: [] }));
  for (let r = 0; r < rows - 1; r++) for (let q = 0; q < cols - 1; q++) {
    const i = r * cols + q, tl = f[i], tr = f[i + 1], br = f[i + cols + 1], bl = f[i + cols];
    const lo = Math.min(tl, tr, br, bl);
    if (lo >= top) continue; // nothing crosses here: most cells
    const hi = Math.max(tl, tr, br, bl), x = x0 + q * CELL, y = y0 + r * CELL;
    for (let k = 0; k < levels.length; k++) {
      const L = levels[k];
      if (L <= lo || L > hi) continue;
      const at = (a, b) => (b === Infinity ? 1 : a === Infinity ? 0 : (L - a) / (b - a));
      const side = (s) => s === 0 ? [x + at(tl, tr) * CELL, y] : s === 1 ? [x + CELL, y + at(tr, br) * CELL]
        : s === 2 ? [x + at(bl, br) * CELL, y + CELL] : [x, y + at(tl, bl) * CELL];
      for (const [a, b] of MARCH[(tl < L) * 8 + (tr < L) * 4 + (br < L) * 2 + (bl < L)]) layers[k].segs.push([...side(a), ...side(b)]);
    }
  }
  return layers;
}

// The film grain's strength: Emergence settings' Grain (shared agent-graph.filmGrain, percent, 0 to 25).
export const grainOpacity = (p) => (Number.isFinite(p) && p >= 0 && p <= 25 ? p : 10) / 100;

// The dot grid's strength: Emergence settings' Background dots (shared agent-graph.dots, percent, 0 to 25).
export const DOTS_DEFAULT = 25;
export const dotsAlpha = (p) => (Number.isFinite(p) && p >= 0 && p <= 25 ? p : DOTS_DEFAULT) / 100;

// The oldest finished sub-agent shown: Emergence settings' Sub-agent history (shared agent-graph.history: 1, 3 or 7
// days), a week unless chosen and at most (an old saved 30 reads as a week).
export const historySince = (days, now) => now - ([1, 3, 7].includes(days) ? days : 7) * 86_400_000;

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

// An isolated sub-agent's worktree (machine|top, a worktree card's id) -> who works there, a running sub-agent before
// finished ones: an orchestrator's worktrees otherwise show no agent, since its sub-agents sit under it (subItems).
export function worktreeOwners(items, subs) {
  const name = new Map(items.map((i) => [i.id, i.name]));
  const out = new Map();
  for (const s of subs.filter((s) => s.sub?.worktree).sort((a, b) => Number(!!b.sub.running) - Number(!!a.sub.running))) {
    const k = `${s.machine ?? ""}|${s.sub.worktree}`;
    if (!out.has(k)) out.set(k, { agent: name.get(s.owner), task: s.name, running: s.sub.running });
  }
  return out;
}

// The graph's terminals: live ones, minus the side chat slots (layout block side-slots, mods/side). A side chat is in
// the sidebar's Side chats; here, a click on it would swap the panel the graph is in for the Side view.
export const graphTerminals = (terminals, sideSlots) => terminals.filter((x) => x.state === "live" && !sideSlots.includes(x.name));

// ---- A sub-agent's details (the dialog a sub-agent card opens: detail.js) ----

// What subagents.py --detail needs to find one sub-agent: its agent's pid and harness, the worktree top, its id.
// null: not one it reads (a history card, another machine, a harness it doesn't read).
export function detailRequest(card, items, top) {
  const o = card?.sub && items.find((i) => i.id === card.owner);
  if (!o || o.machine || !["claude", "omp"].includes(o.harness)) return null;
  if (o.session && !o.pid) return { session: o.session, harness: o.harness, top: o.top ?? top(o), id: card.sub.id }; // an ended agent (endedItems)
  return o.pid ? { pid: o.pid, harness: o.harness, top: top(o), id: card.sub.id } : null;
}

// "45s", "6m 26s", "1h 13m".
export function took(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// "opus-5-5" from "claude-opus-5-5" or omp's "anthropic/claude-opus-5-5".
export const modelName = (m) => m?.replace(/^.*\//, "").replace(/^claude-/, "") || null;

// ---- A sub-agent's steps (its tool calls, the dialog's Steps tab) ----

const KIND = { read: "read", edit: "edit", multiedit: "edit", write: "edit", notebookedit: "edit", bash: "run", grep: "search", glob: "search", ls: "search",
  find: "search", agent: "agent", task: "agent", fetch: "web" }; // Claude's names and omp's, lower-cased
export const stepKind = (tool) => KIND[tool?.toLowerCase()] ?? (tool?.toLowerCase().startsWith("web") ? "web" : "other");

// [{ kind, n }], most first (ties as they first came).
export function toolMix(steps) {
  const n = new Map();
  for (const s of steps) n.set(stepKind(s.tool), (n.get(stepKind(s.tool)) ?? 0) + 1);
  return [...n].map(([kind, k]) => ({ kind, n: k })).sort((a, b) => b.n - a.n);
}

// Rows for the timeline: a run of GROUP or more calls of one kind folds into { group, id, kind, steps, at, ms, ok }
// (ok/ms null while one runs); a failed call is never folded away.
const GROUP = 3;
export function groupSteps(steps) {
  const rows = [];
  for (let i = 0; i < steps.length;) {
    let j = i;
    while (j < steps.length && steps[j].ok !== false && stepKind(steps[j].tool) === stepKind(steps[i].tool)) j++;
    if (steps[i].ok !== false && j - i >= GROUP) {
      const run = steps.slice(i, j), open = run.some((s) => s.ok == null);
      rows.push({ group: true, id: `g:${run[0].call}`, kind: stepKind(run[0].tool), steps: run, at: run[0].at,
        ms: open ? null : run.reduce((a, s) => a + (s.ms ?? 0), 0), ok: open ? null : true });
      i = j;
    } else rows.push(steps[i++]);
  }
  return rows;
}

// "+0:04", "+12:34", "+1:02:03".
export function offset(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), p = (n) => String(n).padStart(2, "0");
  return s < 3600 ? `+${Math.floor(s / 60)}:${p(s % 60)}` : `+${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// Beside a step's label: a file's folder (its name is in the label), the last two folders at most; else its target.
export function stepTarget(s) {
  const t = s.target ?? "";
  if (!["read", "edit"].includes(stepKind(s.tool))) return t;
  const dir = t.slice(0, Math.max(0, t.lastIndexOf("/"))), parts = dir.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : dir;
}

// Beside a folded run: what it touched, each once (files by name), four at most.
export function groupTarget(steps) {
  const seen = [...new Set(steps.map((s) => (["read", "edit"].includes(stepKind(s.tool)) ? s.target?.split("/").pop() : s.target)).filter(Boolean))];
  return seen.slice(0, 4).join(", ") + (seen.length > 4 ? ` +${seen.length - 4}` : "");
}

// Emergence's dialog frame (RECIPE "Dialogs"), for the details dialog; mods/dialogs.test.js holds every dialog's copy to it.
export const DIALOG = { pad: 24, gap: 16, title: 22, radius: 10, button: 32 };

// A sub-agent's task or result folded for its details: whole lines within `fold` characters (the first line always),
// never leaving a code fence open: a cut inside one closes it, so what follows doesn't render as one long code block.
// -> { text, more: lines left out }.
export function foldMarkdown(body, fold) {
  const lines = String(body ?? "").replace(/\s+$/, "").split("\n");
  let n = 0, chars = 0;
  while (n < lines.length && (n === 0 || chars + lines[n].length <= fold)) chars += lines[n++].length;
  let fence = null; // the open fence's marker (``` or ~~~, at least that long)
  for (const l of lines.slice(0, n)) {
    const m = /^\s*(`{3,}|~{3,})/.exec(l);
    if (!m) continue;
    if (!fence) fence = m[1];
    else if (m[1][0] === fence[0] && m[1].length >= fence.length && !l.trim().slice(m[1].length).trim()) fence = null;
  }
  return { text: lines.slice(0, n).join("\n") + (fence ? `\n${fence}` : ""), more: lines.length - n };
}
