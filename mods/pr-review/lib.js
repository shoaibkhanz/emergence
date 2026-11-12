// Host-free logic for pr-review: unified diff parsing, line selection → GitHub
// review comment payload, review threads → diff rows. Tested by lib.test.js.

const unquote = (p) => (p.startsWith('"') ? JSON.parse(p) : p);
const strip = (p) => (p === "/dev/null" ? null : unquote(p).replace(/^[ab]\//, ""));

// Unified diff (git / gh pr diff) → files with flat rows:
// { kind: "hunk" | "context" | "add" | "del", old, new, text, hunk }.
export function parseDiff(text) {
  const files = [];
  let f = null, oldNo = 0, newNo = 0, hunk = -1;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git ("?a\/.*?"?) ("?b\/.*"?)$/);
      f = { path: m ? strip(m[2]) : line.slice(11), oldPath: m ? strip(m[1]) : null, status: "modified", binary: false, additions: 0, deletions: 0, rows: [] };
      files.push(f); hunk = -1;
    } else if (!f) continue;
    else if (line.startsWith("@@")) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (!m) continue;
      oldNo = +m[1]; newNo = +m[2]; hunk++;
      f.rows.push({ kind: "hunk", old: null, new: null, text: line, hunk });
    } else if (hunk >= 0 && line[0] === "+") { f.rows.push({ kind: "add", old: null, new: newNo++, text: line.slice(1), hunk }); f.additions++; }
    else if (hunk >= 0 && line[0] === "-") { f.rows.push({ kind: "del", old: oldNo++, new: null, text: line.slice(1), hunk }); f.deletions++; }
    else if (hunk >= 0 && line[0] === " ") f.rows.push({ kind: "context", old: oldNo++, new: newNo++, text: line.slice(1), hunk });
    else if (hunk >= 0) continue; // "\ No newline at end of file", trailing blank
    else if (line.startsWith("new file mode")) f.status = "added";
    else if (line.startsWith("deleted file mode")) f.status = "deleted";
    else if (line.startsWith("rename from ")) { f.status = "renamed"; f.oldPath = unquote(line.slice(12)); }
    else if (line.startsWith("rename to ")) f.path = unquote(line.slice(10));
    else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) f.binary = true;
    else if (line.startsWith("--- ")) f.oldPath = strip(line.slice(4)) ?? f.oldPath;
    else if (line.startsWith("+++ ")) f.path = strip(line.slice(4)) ?? f.path;
  }
  for (const x of files) if (x.status !== "renamed") x.oldPath = x.status === "added" ? null : x.path;
  return files;
}

// The side a row is commented on: deleted lines on the old side, the rest on the new.
export const sideOf = (row) => (row.kind === "del" ? "LEFT" : "RIGHT");
export const lineOf = (row, side) => (side === "LEFT" ? row.old : row.new);

// A selection from anchor row to focus row (indices into file.rows), kept on the
// anchor's side and inside its hunk (GitHub refuses ranges across hunks).
// Returns { side, start, end, from, to } (from/to: row indices) or null.
export function selectRange(rows, anchor, focus = anchor) {
  const a = rows[anchor];
  if (!a || a.kind === "hunk") return null;
  const side = sideOf(a);
  const lo = Math.min(anchor, focus), hi = Math.max(anchor, focus);
  let from = anchor, to = anchor;
  for (let i = anchor - 1; i >= lo && rows[i].hunk === a.hunk; i--) if (lineOf(rows[i], side) != null) from = i;
  for (let i = anchor + 1; i <= hi && rows[i].hunk === a.hunk; i++) if (lineOf(rows[i], side) != null) to = i;
  return { side, start: lineOf(rows[from], side), end: lineOf(rows[to], side), from, to };
}

// Selection → the location fields of POST pulls/{n}/comments.
export function commentPayload(path, sel) {
  const p = { path, line: sel.end, side: sel.side };
  if (sel.start !== sel.end) Object.assign(p, { start_line: sel.start, start_side: sel.side });
  return p;
}

// Review threads → { at: Map(rowIndex → threads), loose: threads without a row }.
// A thread hangs under its last line; outdated ones (line null) are loose.
export function anchorThreads(rows, threads) {
  const at = new Map(), loose = [];
  for (const t of threads) {
    const i = t.line == null ? -1 : rows.findIndex((r) => lineOf(r, t.diffSide) === t.line);
    if (i < 0) loose.push(t);
    else at.set(i, [...(at.get(i) ?? []), t]);
  }
  return { at, loose };
}

export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`;
  return `${Math.floor(s / 86400 / 365)}y`;
}

// First index whose top + height passes y (tops ascending).
export function firstVisible(tops, heights, y) {
  let lo = 0, hi = tops.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tops[m] + heights[m] <= y) lo = m + 1; else hi = m; }
  return lo;
}

/** Changed files → folder-tree rows: folders first, then files, each by name; a folder holding only one
 *  folder folds into it ("src/lib"). Rows: { dir: true, name, depth } | { fi, name, depth } (fi: index in files). */
export function fileTree(files) {
  const node = () => ({ dirs: new Map(), files: [] }), root = node();
  files.forEach((f, fi) => {
    const parts = f.path.split("/"), name = parts.pop();
    let n = root;
    for (const p of parts) n = n.dirs.get(p) ?? n.dirs.set(p, node()).get(p);
    n.files.push({ fi, name });
  });
  const rows = [], byName = (a, b) => (a[0] ?? a.name).localeCompare(b[0] ?? b.name);
  const walk = (n, depth) => {
    for (let [name, d] of [...n.dirs].sort(byName)) {
      while (!d.files.length && d.dirs.size === 1) { const [[k, v]] = d.dirs; name += `/${k}`; d = v; }
      rows.push({ dir: true, name, depth });
      walk(d, depth + 1);
    }
    for (const f of n.files.sort(byName)) rows.push({ fi: f.fi, name: f.name, depth });
  };
  walk(root, 0);
  return rows;
}

/** Review labels, sent as a shields.io badge on its own line above the comment so GitHub shows it:
 *  [key, label, badge colour, the theme colour that matches it]. */
export const TAGS = [["statement", "Statement", "green", "ansi2"], ["question", "Question", "blue", "ansi4"], ["nit", "Nit", "purple", "ansi5"], ["minor", "Minor", "yellow", "ansi3"], ["major", "Major", "red", "ansi1"]];
const BADGE = /^!\[(statement|question|nit|minor|major)\]\(https:\/\/img\.shields\.io\/badge\/[^)\s]*\)\s*/;
export const tagBody = (tag, text) => (tag ? `![${tag}](https://img.shields.io/badge/${tag}-${TAGS.find(([k]) => k === tag)[2]})\n${text}` : text);
export function splitTag(body) {
  const m = BADGE.exec(body ?? "");
  return m ? { tag: m[1], text: body.slice(m[0].length) } : { tag: null, text: body ?? "" };
}
