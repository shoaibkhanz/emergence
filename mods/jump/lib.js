// Jump's list, kept pure for bun test: a few recent sessions, then every space as the sidebar nests them (a repo's
// main checkout, its worktree spaces under it, then its worktrees nothing has open), one line a row.

export const inside = (p, dir) => Boolean(p) && (p === dir || p.startsWith(dir + "/"));
export const STATE = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };
const RECENT_N = 3, OPEN_WTS = 2; // recent sessions shown; a repo's unopened worktrees shown before "N more"

/**
 * spaces: spaces() in the sidebar's order (spaces-plus moves them so). tabs: [{ kind: "tab", s (its space), tb, cwd,
 * branch, here, who, on, state }]. wts: every checkout of the repos a terminal is in, [{ path, machine, repo, key (one
 * per repo), branch, main (the repo's main checkout), at }]. recent: tab ids, the one shown last first. query: what's
 * typed. expanded: repo keys whose unopened worktrees are all shown. archived: JSON [machine, path] of worktrees the
 * sidebar archived (shown only while typing).
 * -> { rows, pick, total, shown }: rows [{ kind: "label" | "space" | "tab" | "wt" | "more" | "repo" | "new", depth, dim? }]
 *    (a space with one session is one row: `tab` holds it); pick, the row ↵ goes to first; total spaces, and shown.
 * Untyped: Recent (the last RECENT_N sessions shown, not where you are; the first is picked, so ⌘E ↵ goes back and
 * again comes forth), then Spaces. Typed: every word, anywhere in a row (names, branch, agent, what it's on, its state:
 * "needs you"; its folder last); matches keep their parents, dimmed, and a match keeps all it holds. Groups (a space
 * at the top and all under it) go by their best match, a word starting a name first, a folder last, else as the
 * sidebar has them; nothing is reordered inside a group. A branch name nothing has offers a new worktree.
 */
export function jumpRows({ spaces, tabs, wts, recent = [], query = "", expanded = new Set(), archived = new Set() }) {
  const q = query.replace(/^\s*\//, "").trim(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (r) => (r.here ? -1 : recent.includes(r.tb.id) ? recent.indexOf(r.tb.id) : Infinity);
  const machine = (x) => x.machine ?? x.s?.machine ?? null;
  const checkout = (path, m) => wts.filter((w) => w.machine === m && inside(path, w.path)).sort((a, b) => b.path.length - a.path.length)[0];
  const repoId = (w) => `${w.machine ?? ""}\n${w.key}`;

  // Each space: its sessions (tab order) and its checkout (where its first session is).
  const info = spaces.map((s) => {
    const mine = tabs.filter((r) => r.s.id === s.id), lead = mine.find((r) => r.cwd) ?? mine[0];
    return { s, tabs: mine, wt: checkout(lead?.cwd ?? s.folder, s.machine ?? null) };
  });
  const open = new Set([...tabs.map((r) => checkout(r.cwd, machine(r))), ...info.map((i) => i.wt)].filter(Boolean));
  const mains = new Set(info.filter((i) => i.wt?.main).map((i) => repoId(i.wt)));
  const nested = (i) => i.wt && !i.wt.main && mains.has(repoId(i.wt));

  // The tree, as the sidebar draws it; each node knows what it holds (kids) for "a match keeps all it holds".
  const tree = [];
  const node = (row, depth, parent) => { const n = { row: { ...row, depth }, parent, kids: [] }; (parent?.kids ?? tree).push(n); return n; };
  const space = (i, depth, parent) => {
    if (i.tabs.length === 1) return node({ kind: "space", s: i.s, wt: i.wt, tab: i.tabs[0], here: i.tabs[0].here }, depth, parent);
    const n = node({ kind: "space", s: i.s, wt: i.wt, here: i.tabs.some((r) => r.here) }, depth, parent);
    for (const r of i.tabs) node(r, depth + 1, n);
    return n;
  };
  const unopened = (id, depth, parent) => {
    const list = wts.filter((w) => repoId(w) === id && !open.has(w) && (words.length || !archived.has(JSON.stringify([w.machine, w.path]))));
    const all = words.length || expanded.has(list[0]?.key) || list.length <= OPEN_WTS + 1;
    for (const w of all ? list : list.slice(0, OPEN_WTS)) node({ kind: "wt", ...w }, depth, parent);
    if (!all) node({ kind: "more", key: list[0].key, machine: list[0].machine, count: list.length - OPEN_WTS }, depth, parent);
  };
  const placed = new Set();
  for (const i of info) {
    if (nested(i)) continue;
    const top = space(i, 0, null);
    if (!i.wt || placed.has(repoId(i.wt))) continue;
    placed.add(repoId(i.wt));
    for (const k of info.filter((k) => nested(k) && repoId(k.wt) === repoId(i.wt))) space(k, 1, top);
    unopened(repoId(i.wt), 1, top);
  }
  for (const id of new Set(wts.filter((w) => !open.has(w) && !placed.has(repoId(w))).map(repoId))) { // a repo no space is in
    const w = wts.find((x) => repoId(x) === id);
    unopened(id, 1, node({ kind: "repo", repo: w.repo, machine: w.machine }, 0, null));
  }

  // How well a row matches: 0 a word starts a name, 1 inside a name, 2 its agent, what it's on or its state, 3 its
  // folder; the worst of its words. null: some word isn't there.
  const fields = (r) => {
    const t = r.kind === "tab" ? r : r.tab;
    const names = r.kind === "wt" ? [r.branch, r.repo] : r.kind === "space" ? [r.s.name, r.wt?.branch, t?.tb.name, t?.branch] : r.kind === "tab" ? [r.tb.name, r.branch] : [];
    return { names: names.filter(Boolean).join(" ").toLowerCase(), more: [t?.who, t?.on, STATE[t?.state]].filter(Boolean).join(" ").toLowerCase(),
      path: [r.kind === "wt" ? r.path : t?.cwd ?? r.wt?.path, machine(r)].filter(Boolean).join(" ").toLowerCase() };
  };
  const starts = (h, w) => h.split(/[^\p{L}\p{N}]+/u).some((x) => x.startsWith(w)) || h.startsWith(w);
  const score = (r) => {
    if (!words.length) return 0;
    const f = fields(r);
    let worst = 0;
    for (const w of words) {
      const s = starts(f.names, w) ? 0 : f.names.includes(w) ? 1 : f.more.includes(w) ? 2 : f.path.includes(w) ? 3 : null;
      if (s === null) return null;
      worst = Math.max(worst, s);
    }
    return worst;
  };

  // Typed: a node shows if it matches, holds a match (dimmed), or sits in a matching node.
  const groups = [];
  const walk = (n, inMatch) => {
    const s = n.row.kind === "repo" || n.row.kind === "more" ? null : score(n.row), hit = inMatch || s !== null;
    const below = n.kids.map((k) => walk(k, hit)).filter(Boolean);
    if (!hit && !below.length) return null;
    const best = Math.min(s ?? Infinity, ...below.map((b) => b.best));
    return { row: { ...n.row, dim: !hit, score: s }, below, best };
  };
  tree.forEach((n, order) => { const g = walk(n, false); if (g) groups.push({ ...g, order }); });
  if (words.length) groups.sort((a, b) => a.best - b.best || a.order - b.order);
  const rows = [];
  const flat = (g) => { rows.push(g.row); g.below.forEach(flat); };

  if (!words.length) {
    const last = tabs.filter((r) => !r.here && rank(r) !== Infinity).sort((a, b) => rank(a) - rank(b)).slice(0, RECENT_N);
    if (last.length) rows.push({ kind: "label", text: "Recent" }, ...last.map((r) => ({ ...r, recent: true, depth: 0 })), { kind: "label", text: "Spaces" });
  }
  groups.forEach(flat);
  const at = tabs.find((r) => r.here), mine = at && checkout(at.cwd, machine(at));
  if (/^[\w./-]+$/.test(q) && mine && !wts.some((w) => repoId(w) === repoId(mine) && w.branch === q)) {
    rows.push({ kind: "new", depth: 0, branch: q, space: at.s, cwd: at.cwd, repo: mine.repo });
  }

  const goable = (r) => r.kind !== "label" && r.kind !== "repo" && !r.dim;
  const session = (r) => (r.kind === "tab" ? r : r.tab);
  const cands = rows.map((r, i) => [r, i]).filter(([r]) => goable(r) && r.kind !== "new");
  const best = words.length
    ? cands.filter(([r]) => r.score !== null).sort(([a, i], [b, j]) => a.score - b.score || (session(a) ? rank(session(a)) : Infinity) - (session(b) ? rank(session(b)) : Infinity) || i - j)[0]
    : cands.find(([r]) => r.recent) ?? cands.find(([r]) => session(r) && !session(r).here);
  return { rows, pick: (best ?? cands[0] ?? [null, 0])[1], total: spaces.length, shown: rows.filter((r) => r.kind === "space" && !r.dim).length };
}

// The next row ↑/↓ lands on, wrapping: section labels and a repo's heading don't go anywhere, so they're passed.
export function step(rows, at, by) {
  for (let n = 1, i = at; n <= rows.length; n++) {
    i = (i + by + rows.length) % rows.length;
    if (rows[i].kind !== "label" && rows[i].kind !== "repo") return i;
  }
  return at;
}

// A row's identity across renders: the list shifts when worktrees arrive (they're read after the first frame), so the
// highlight follows its row, not its position.
export const rowKey = (r) => (r.kind === "tab" ? `${r.recent ? "recent" : "tab"}:${r.tb.id}` : r.kind === "space" ? `space:${r.s.id}`
  : r.kind === "wt" ? `wt:${r.machine ?? ""}:${r.path}` : r.kind === "more" || r.kind === "repo" ? `${r.kind}:${r.machine ?? ""}:${r.key ?? r.repo}`
  : r.kind === "label" ? `label:${r.text}` : `new:${r.branch}`);

// The highlighted row's index: the chosen one (key, from ↑/↓) while it's listed, else jumpRows' pick.
export function selected({ rows, pick }, key) {
  const i = key == null ? -1 : rows.findIndex((r) => rowKey(r) === key);
  return i < 0 ? pick : i;
}
