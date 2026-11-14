// GitLab REST (glab api) JSON → the shapes github.js returns, so the panel has one code path. Pure: no herdr import.

// Which forge to try first, and the other as fallback: a GitHub Enterprise host or ssh alias needn't say "github".
export const forgeOrder = (url) => (/github/i.test(url ?? "") ? ["github", "gitlab"] : ["gitlab", "github"]);

const STATE = { opened: "OPEN", merged: "MERGED", closed: "CLOSED", locked: "CLOSED" };
// GitLab's list carries no line counts: null, and the panel shows none.
export const mapMR = (mr) => ({
  number: mr.iid, title: mr.title, state: STATE[mr.state] ?? "OPEN", isDraft: Boolean(mr.draft), author: { login: mr.author?.username },
  additions: null, deletions: null, updatedAt: mr.updated_at, headRefName: mr.source_branch, baseRefName: mr.target_branch,
});

// The panel's states are gh's; gh's "closed" includes merged, GitLab's doesn't.
export const glStates = (state) => ({ open: ["opened"], closed: ["closed", "merged"], merged: ["merged"] })[state] ?? ["all"];

// A range's first line: its numbers, else from its line code "<sha>_<old>_<new>" (all GitLab sends back).
function rangeStart(range) {
  const st = range?.start;
  if (!st) return null;
  if (st.new_line != null || st.old_line != null) return st.new_line ?? st.old_line;
  const [, old, nu] = (st.line_code ?? "").split("_");
  return Number(nu || old) || null;
}

const comment = (n, me) => ({ id: n.id, databaseId: n.id, body: n.body, author: { login: n.author?.username }, createdAt: n.created_at,
  viewerCanUpdate: n.author?.username === me, viewerCanDelete: n.author?.username === me });

// { headOid, threads, talk } as github.js threads(): diff notes are threads; other notes and the description the talk.
export function mapThreads(discussions, mr, me) {
  const head = mr.diff_refs?.head_sha, threads = [], talk = [{ id: "body", kind: "body", author: mr.author?.username, at: mr.created_at, body: mr.description }];
  for (const d of discussions) {
    const notes = d.notes.filter((n) => !n.system);
    if (!notes.length) continue;
    const p = notes[0].type === "DiffNote" && notes[0].position;
    // Outdated (written at an older head): no line, so the panel shows it apart, as GitHub does; GitLab keeps the old
    // version's numbers, which would hang it on whatever code has them now.
    const out = p && p.head_sha !== head;
    if (p) threads.push({
      id: d.id, isResolved: Boolean(notes[0].resolved), isOutdated: out, path: p.new_path ?? p.old_path,
      line: out ? null : p.new_line ?? p.old_line, startLine: out ? null : rangeStart(p.line_range),
      diffSide: p.new_line != null ? "RIGHT" : "LEFT", comments: notes.map((n) => comment(n, me)),
    });
    else for (const n of notes) talk.push({ ...comment(n, me), kind: "comment", author: n.author?.username, at: n.created_at });
  }
  return { headOid: head, threads, talk: talk.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
}

// GET repository/commits/:sha/diff → a unified diff with git headers, as `gh api … application/vnd.github.diff` gives.
export const commitDiffText = (diffs) => diffs.map((d) => [
  `diff --git a/${d.old_path} b/${d.new_path}`,
  ...(d.new_file ? ["new file mode 100644"] : d.deleted_file ? ["deleted file mode 100644"] : []),
  ...(d.renamed_file ? [`rename from ${d.old_path}`, `rename to ${d.new_path}`] : []),
  `--- ${d.new_file ? "/dev/null" : `a/${d.old_path}`}`, `+++ ${d.deleted_file ? "/dev/null" : `b/${d.new_path}`}`,
  d.diff.replace(/\n$/, ""),
].join("\n")).join("\n") + "\n";

// The panel's comment payload → POST discussions' `position` (sent as one JSON value). An unchanged line needs both
// numbers. lineCode(old, new) names a line for line_range (null: no range).
export function position(p, v, lineCode) {
  const pos = { base_sha: v.base_commit_sha, start_sha: v.start_commit_sha, head_sha: v.head_commit_sha, position_type: "text",
    new_path: p.path, old_path: p.old_path ?? p.path };
  const { start, end } = p.anchor;
  if (end.old != null) pos.old_line = end.old;
  if (end.new != null) pos.new_line = end.new;
  const at = (r) => ({ line_code: lineCode(r.old, r.new), type: r.new != null ? "new" : "old" });
  if (p.start_line != null && lineCode) pos.line_range = { start: at(start), end: at(end) };
  return pos;
}

// The MR version a comment's head belongs to (its own base/start SHAs), else the newest.
export const versionFor = (versions, head) => versions.find((v) => v.head_commit_sha === head) ?? versions[0];
