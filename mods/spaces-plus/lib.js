// The worktree tree, pure (no herdr import) so it can be tested.

const base = (path) => path.replace(/\/+$/, "").split("/").pop();

// `git worktree list --porcelain`: one block per worktree; branch without refs/heads/, null when detached.
export function parseWorktrees(text) {
  return text.split(/\n\n+/).filter((b) => b.startsWith("worktree ")).map((b) => {
    const lines = b.split("\n");
    const branch = lines.find((l) => l.startsWith("branch "));
    return {
      path: lines[0].slice(9),
      branch: branch ? branch.slice(7).replace(/^refs\/heads\//, "") : null,
      bare: lines.includes("bare"),
      prunable: lines.some((l) => l.startsWith("prunable")),
    };
  });
}

// `git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads`.
export function parseTrack(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const [name, ...rest] = line.split(" "), t = rest.join(" ");
    if (name) out[name] = { ahead: Number(/ahead (\d+)/.exec(t)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(t)?.[1] ?? 0) };
  }
  return out;
}

// `git for-each-ref --merged HEAD --format="%(refname:lstrip=2) %(objectname)" refs/heads` and `git rev-parse HEAD` ->
// the branches merged into the main checkout, less those still at HEAD: a new worktree (a sub-agent's) isn't done.
export function mergedBranches(refs, head) {
  const at = head.trim();
  return new Set(refs.split("\n").map((l) => l.trim().split(" ")).filter(([b, sha]) => b && sha !== at).map(([b]) => b));
}

// ordered() rows ({w, i, g, tree}) -> rows with keys, each repo's worktrees that have no space yet (greyed) after
// the nested spaces of its first main space (a bare repo has none: after its first space). An open worktree is
// matched by path or branch: git and rev-parse can print one path two ways (/tmp vs /private/tmp).
// `archived`: JSON [machine, path] -> the space closed by archiving it (or null); those aren't listed.
// The worktrees with no space fold into one "others" row (open when `othersOpen` has the repo's space id), then
// "clean": Clean up, ticking those whose branch is in the tree's `merged` (keys as worktree-sweep's items).
export function addWorktrees(rows, trees, folded, archived = {}, othersOpen = new Set()) {
  const out = [];
  const placed = new Set();
  for (let n = 0; n < rows.length; n++) {
    const r = rows[n];
    if (r.tree) continue; // drawn with its main below
    const row = { ...r, kind: "space", key: `s:${r.w.id}`, kids: 0, parent: null };
    out.push(row);
    if (!r.g || (r.g.linked && !trees[r.g.repo]?.list.some((wt) => wt.bare)) || placed.has(r.g.repo)) continue;
    placed.add(r.g.repo);
    const kids = [], rest = [];
    for (let k = n + 1; k < rows.length && rows[k].tree; k++) kids.push({ ...rows[k], kind: "space", key: `s:${rows[k].w.id}`, kids: 0, parent: row.key });
    const same = rows.filter((s) => s.g?.repo === r.g.repo);
    const tops = new Set(same.map((s) => s.g.top)), branches = new Set(same.map((s) => s.g.branch));
    const on = JSON.parse(r.g.repo)[0];
    const tree = trees[r.g.repo];
    for (const wt of tree?.list ?? []) {
      if (wt.bare || wt.prunable || tops.has(wt.path) || (wt.branch && branches.has(wt.branch))) continue;
      if (JSON.stringify([on, wt.path]) in archived) continue;
      const track = (wt.branch && tree.track[wt.branch]) || { ahead: 0, behind: 0 };
      rest.push({ kind: "wt", key: `p:${JSON.stringify([on, wt.path])}`, parent: row.key, on, path: wt.path, label: wt.branch ?? base(wt.path), branch: wt.branch ?? null, ahead: track.ahead, behind: track.behind });
    }
    row.kids = kids.length + rest.length;
    if (rest.length) {
      const open = othersOpen.has(r.w.id), merged = tree.merged ?? new Set();
      kids.push({ kind: "others", key: `o:${r.w.id}`, parent: row.key, on, id: r.w.id, n: rest.length, open });
      if (open) kids.push(...rest, { kind: "clean", key: `c:${r.w.id}`, parent: row.key, on,
        ticks: rest.filter((w) => w.branch && merged.has(w.branch)).map((w) => JSON.stringify([w.on, w.path])) });
    }
    if (!folded.has(r.w.id)) out.push(...kids);
  }
  return out;
}

// The cursor after a refresh: kept if still there, else the nearest row before it that is, else the first.
export function nearest(keys, old, cur) {
  if (keys.includes(cur)) return cur;
  for (let i = old.indexOf(cur) - 1; i >= 0; i--) if (keys.includes(old[i])) return old[i];
  return keys[0] ?? null;
}

// The worktree a row stands for, for archive and delete: a greyed worktree, or an open space in a linked worktree.
// null for a main checkout (git can't remove it) or a folder outside git.
export function actionTarget(r) {
  if (r.kind === "wt") return { on: r.on, path: r.path, label: r.label, branch: r.branch ?? null, space: null };
  if (!r.g?.linked) return null;
  return { on: JSON.parse(r.g.repo)[0], path: r.g.top, label: r.g.branch, branch: r.g.branch ?? null, space: r.w.id };
}

// Archived worktrees open again in a space (from ⌘E Jump): not the space the archive closed, which can still be
// on its way out. Their keys leave the archive.
export function reopened(archived, rows) {
  return rows.filter((r) => r.g?.linked).map((r) => [JSON.stringify([JSON.parse(r.g.repo)[0], r.g.top]), r.w.id])
    .filter(([k, id]) => k in archived && archived[k] !== id).map(([k]) => k);
}

// What a row is for the Agents graph's ring (agent-graph lib's ringed): a space, or a worktree no space has open.
export function cursorOf(r) {
  if (r?.kind === "wt") return { kind: "worktree", on: r.on, path: r.path };
  return r?.w ? { kind: "space", id: r.w.id } : null;
}

// `git status --porcelain`'s exec result -> how many files have uncommitted changes (untracked too); null: git failed.
export function changeCount(st) {
  return st.code === 0 ? st.stdout.split("\n").filter(Boolean).length : null;
}

// The red line under the archive confirm's Delete permanently (`git worktree remove --force`): what it loses.
export function forceWarn(n) {
  if (n === 0) return "Delete permanently removes the folder now. Can't be undone.";
  const what = n === null ? "any uncommitted changes" : `its ${n} uncommitted change${n === 1 ? "" : "s"}`;
  return `Delete permanently loses ${what}. Can't be undone.`;
}

// git's args for commits on a worktree's HEAD that no remote and no other local branch has: what lives only there.
// --exclude takes the bare branch name under --branches. (A worktree's own branch is kept on delete; detached, they'd
// be left behind.)
export const onlyHereArgs = (branch) => ["rev-list", "--count", "HEAD", "--not", "--remotes", ...(branch ? [`--exclude=${branch}`] : []), "--branches"];

// The amber line on a delete or archive confirm for those commits (n from onlyHereArgs; null: none or unknown).
export function keptNote(n, branch) {
  if (!n) return null;
  const c = `${n} commit${n === 1 ? "" : "s"}`;
  return branch ? `${c} ${n === 1 ? "is" : "are"} only on ${branch}: not pushed or merged. The branch keeps ${n === 1 ? "it" : "them"}.`
    : `${c} here are on no branch or remote: deleting leaves them behind.`;
}

// A repo's name from its git folder: /x/app/.git -> app, /x/app.git (bare) -> app.
export const repoName = (repo) => repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");

// The bulk delete dialog's list (worktree-sweep): every linked worktree in `trees`, archived ones too, never a main
// checkout (git lists it first; a bare repo's own entry too), a bare or a prunable one. `opens`: the open spaces in
// linked worktrees, [{repo, top, branch, id}], matched by path or branch as addWorktrees does: the space to close.
export function sweepItems(trees, opens, archived = {}) {
  return Object.entries(trees).flatMap(([repo, { list }]) => {
    const [on, dir] = JSON.parse(repo);
    return list.slice(1).filter((wt) => !wt.bare && !wt.prunable).map((wt) => {
      const key = JSON.stringify([on, wt.path]);
      const open = opens.find((o) => o.repo === repo && (o.top === wt.path || (wt.branch && o.branch === wt.branch)));
      return { key, on, path: wt.path, label: wt.branch ?? base(wt.path), branch: wt.branch ?? null, repo: repoName(dir), space: open?.id ?? null, archived: key in archived };
    });
  });
}

// The notice after a bulk delete: labels removed, labels skipped (uncommitted changes), [label, git's error] refused.
export function sweepReport(removed, skipped, failed) {
  const n = removed.length;
  const body = [skipped.length ? `Skipped ${skipped.length} with uncommitted changes: ${skipped.join(", ")}.` : "",
    ...failed.map(([label, err]) => `Couldn't delete ${label}: ${err.replace(/\.$/, "")}.`)].filter(Boolean).join(" ");
  return { title: n ? `Deleted ${n} worktree${n === 1 ? "" : "s"}` : "No worktrees deleted", body: body || "Branches stay.",
    level: failed.length ? "error" : skipped.length ? "warning" : "success" };
}

// Spaces' sizes (px): its header (shorter than the other sections': it tops the sidebar), a row (a worktree's or a
// nested space's a little less), and the room under the list, which the inbox leaves under its cards too
// (mods/sidebar.test.js holds the sections' copies together).
export const HEADER_H = 31, ROW_H = 30, SUB_ROW_H = 28, LIST_PAD = 14;
