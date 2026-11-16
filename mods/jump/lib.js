// Jump's list, kept pure for bun test: spaces with their sessions under them, and each repo's worktrees nothing has
// open under the space you were in last in that repo (a repo no space is in heads its own).

export const inside = (p, dir) => Boolean(p) && (p === dir || p.startsWith(dir + "/"));

/**
 * tabs: [{ kind: "tab", s (its space), tb, cwd, branch, here, who, on }], in space order.
 * wts: every checkout of the repos a terminal is in, [{ path, machine, repo, key (one per repo), branch, at }].
 * recent: tab ids, the one shown last first (shared "jump.recent"). query: what's typed.
 * -> { rows, pick }: rows [{ kind: "space" | "repo" | "tab" | "wt" | "new", depth, ... }]; pick, the row ↵ goes to
 *    first: the session shown last that isn't where you are, so ⌘E ↵ goes back and again comes forth.
 * Where you are comes first, then each space by its session shown last (never-shown ones keep space order); in a
 * space, its sessions by the same. Typing keeps the spaces with a match: every word, anywhere in a session's tab,
 * space, branch, folder, agent or what it's on, a worktree's branch, path or repo; a space's name also finds its repo's
 * other checkouts, as the sidebar nests them. A leading "/" is ignored. A branch name nothing has offers a new
 * worktree for it, in the repo you're in.
 */
export function jumpRows({ tabs, wts, recent = [], query = "" }) {
  const q = query.replace(/^\s*\//, "").trim(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const fits = (...hay) => { const h = hay.filter(Boolean).join(" ").toLowerCase(); return words.every((w) => h.includes(w)); };
  const rank = (r) => (r.here ? -1 : recent.includes(r.tb.id) ? recent.indexOf(r.tb.id) : Infinity);
  const machine = (r) => r.s.machine ?? null;
  // The checkout a session is in: the innermost one holding its folder.
  const repoOf = (r) => wts.filter((w) => w.machine === machine(r) && inside(r.cwd, w.path)).sort((a, b) => b.path.length - a.path.length)[0];
  const names = new Map();
  for (const r of tabs) { const k = repoOf(r)?.key; if (k) names.set(k, [...(names.get(k) ?? []), r.s.name]); }
  const kin = (k) => names.get(k) ?? [];

  const groups = [];
  for (const r of tabs) {
    const g = groups.find((x) => x.s.id === r.s.id) ?? groups[groups.push({ s: r.s, order: groups.length, tabs: [], wts: [] }) - 1];
    g.tabs.push(r);
  }
  for (const g of groups) {
    g.tabs = [...g.tabs].sort((a, b) => rank(a) - rank(b));
    g.rank = rank(g.tabs[0]);
    g.at = repoOf(g.tabs[0]);
  }
  groups.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const open = new Set(tabs.map(repoOf).filter(Boolean));
  for (const w of wts.filter((x) => !open.has(x))) {
    const g = groups.find((x) => x.at?.key === w.key && x.at.machine === w.machine)
      ?? groups[groups.push({ repo: w, tabs: [], wts: [] }) - 1];
    g.wts.push(w);
  }

  const rows = [];
  for (const g of groups) {
    const ts = g.tabs.filter((r) => fits(r.tb.name, r.s.name, r.branch, r.cwd, r.who, r.on, ...kin(repoOf(r)?.key)));
    const ws = g.wts.filter((w) => fits(w.branch, w.path, w.repo, w.machine, ...kin(w.key)));
    if (!ts.length && !ws.length) continue;
    rows.push(g.s ? { kind: "space", depth: 0, s: g.s, here: g.rank === -1, repo: g.at?.repo ?? null, branch: g.at?.branch ?? null }
      : { kind: "repo", depth: 0, repo: g.repo.repo, machine: g.repo.machine });
    rows.push(...ts.map((r) => ({ ...r, depth: 1 })), ...ws.map((w) => ({ kind: "wt", depth: 1, ...w })));
  }
  const at = tabs.find((r) => r.here), mine = at && repoOf(at);
  if (/^[\w./-]+$/.test(q) && mine && !wts.some((w) => w.key === mine.key && w.machine === mine.machine && w.branch === q)) {
    rows.push({ kind: "new", depth: 0, branch: q, space: at.s, cwd: at.cwd, repo: mine.repo });
  }
  const sessions = rows.map((r, i) => [r, i]).filter(([r]) => r.kind === "tab");
  const best = sessions.filter(([r]) => !r.here).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)[0] ?? sessions[0];
  return { rows, pick: best ? best[1] : 0 };
}
