import { test, expect } from "bun:test";
import { parseDiff, selectRange, commentPayload, anchorThreads, ago, firstVisible, fileTree, tagBody, splitTag, findAll, mentions, gapBefore, hiddenRows, pairRows, tabArrows, carryLine, carryThreads, toCarry, settle, threadLines, hunkTail } from "./lib.js";

test("findAll: smart case, every match per line, tabs as shown, hunks skipped, given file order", () => {
  const files = parseDiff([
    "diff --git a/a.js b/a.js", "@@ -1,2 +1,2 @@ retry", "-\tretry(retry)", "+Retry()",
    "diff --git a/b.js b/b.js", "@@ -1 +1 @@", " x = retry",
  ].join("\n"));
  expect(findAll(files, "retry").map(({ fi, ri, start }) => [fi, ri, start])).toEqual([[0, 1, 4], [0, 1, 10], [0, 2, 0], [1, 1, 4]]);
  expect(findAll(files, "Retry").map(({ ri }) => ri)).toEqual([2]);
  expect(findAll(files, "retry", [1, 0])[0].fi).toBe(1);
  expect(findAll(files, "")).toEqual([]);
  expect(findAll(files, "aa")).toEqual([]);
});

test("findAll: comments by author or text, in place under their line, loose ones first, badge ignored", () => {
  const files = parseDiff(["diff --git a/a.js b/a.js", "@@ -1,2 +1,2 @@", " x", "+retry()"].join("\n"));
  const c = (login, body) => ({ author: { login }, body });
  const threads = [
    { id: "T1", path: "a.js", line: 1, diffSide: "RIGHT", comments: [c("ana", "why retry here?"), c("bo", "fine")] },
    { id: "T2", path: "a.js", line: null, comments: [c("Retry-app", tagBody("nit", "ok"))] },
    { id: "T3", path: "a.js", line: 2, diffSide: "RIGHT", comments: [c("cy", tagBody("major", "no"))] },
  ];
  expect(findAll(files, "retry", undefined, threads).map((h) => h.th ? `${h.th}/${h.ci}` : h.ri)).toEqual(["T2/0", "T1/0", 2]);
  expect(findAll(files, "bo", undefined, threads).map((h) => h.th)).toEqual(["T1"]);
  expect(findAll(files, "major", undefined, threads)).toEqual([]);
});

test("mentions: users and teams become profile links; emails, code and links stay", () => {
  expect(mentions("cc @ana-b, @org/core-team.")).toBe("cc [@ana-b](https://github.com/ana-b), [@org/core-team](https://github.com/orgs/org/teams/core-team).");
  expect(mentions("mail a@b.com, `@x`, [@y](u), [ping @v](u), https://x.io/?u=@z\n```\n@w\n```")).toBe("mail a@b.com, `@x`, [@y](u), [ping @v](u), https://x.io/?u=@z\n```\n@w\n```");
});

test("hidden lines: gaps before hunks and after the last, numbered on both sides, not selectable", () => {
  const lines = ["a1", "a2", "a3", "a4", "a5", "x", "a6", "a7", "a8", "A9"]; // a1..a9: x added after a5, a9 changed
  const [f] = parseDiff(["diff --git a/f b/f", "@@ -4,4 +4,5 @@", " a4", " a5", "+x", " a6", " a7", "@@ -9 +10 @@", "-a9", "+A9"].join("\n"));
  expect(gapBefore(f.rows, 0)).toEqual({ from: 1, to: 3, old: 1 });
  expect(hiddenRows(f.rows, lines, 0).map((r) => [r.old, r.new, r.text])).toEqual([[1, 1, "a1"], [2, 2, "a2"], [3, 3, "a3"]]);
  expect(hiddenRows(f.rows, lines, 6).map((r) => [r.old, r.new, r.text])).toEqual([[8, 9, "a8"]]);
  expect(hiddenRows(f.rows, lines, f.rows.length)).toEqual([]);
  expect(gapBefore([{ kind: "hunk", text: "@@ -5,2 +4,0 @@" }], 0).to).toBe(4); // nothing added: the deletion sits after line 4
  f.rows.splice(0, 0, ...hiddenRows(f.rows, lines, 0));
  expect(selectRange(f.rows, 1)).toBe(null);
});

test("file tree: folders first, single-folder chains fold, indices kept", () => {
  const files = ["src/lib/b.js", "README.md", "src/lib/a.js", "src/main.js", "docs/specs/x.md"].map((path) => ({ path }));
  expect(fileTree(files)).toEqual([
    { dir: true, name: "docs/specs", depth: 0 }, { fi: 4, name: "x.md", depth: 1 },
    { dir: true, name: "src", depth: 0 }, { dir: true, name: "lib", depth: 1 }, { fi: 2, name: "a.js", depth: 2 }, { fi: 0, name: "b.js", depth: 2 },
    { fi: 3, name: "main.js", depth: 1 },
    { fi: 1, name: "README.md", depth: 0 },
  ]);
});

test("review tags: badge round-trips, untagged and look-alike bodies stay text", () => {
  const body = tagBody("major", "Leaks the token.\n![nit](https://img.shields.io/badge/x) later");
  expect(body.startsWith("![major](https://img.shields.io/badge/major-red)\nLeaks")).toBe(true);
  expect(splitTag(body)).toEqual({ tag: "major", text: "Leaks the token.\n![nit](https://img.shields.io/badge/x) later" });
  expect(splitTag("![nit](https://img.shields.io/badge/nit-purple) posted before the line break")).toEqual({ tag: "nit", text: "posted before the line break" });
  expect(tagBody(null, "plain")).toBe("plain");
  expect(splitTag("![nit](https://evil.example/x) hi")).toEqual({ tag: null, text: "![nit](https://evil.example/x) hi" });
});

const DIFF = `diff --git a/README.md b/README.md
index e83d840..4ea9bfe 100644
--- a/README.md
+++ b/README.md
@@ -1,4 +1,5 @@ title
 # herdr-mods
-old line
+new line
+another
 keep
@@ -10,2 +11,2 @@
-ten
+TEN
 eleven
\\ No newline at end of file
diff --git a/docs/specs/a.md b/docs/b.md
similarity index 99%
rename from docs/specs/a.md
rename to docs/b.md
diff --git a/mods/.gitkeep b/mods/.gitkeep
deleted file mode 100644
index e69de29..0000000
diff --git a/new.js b/new.js
new file mode 100644
--- /dev/null
+++ b/new.js
@@ -0,0 +1,2 @@
+a
+b
diff --git a/logo.png b/logo.png
index 1..2 100644
Binary files a/logo.png and b/logo.png differ
`;

test("parseDiff: files, statuses, numbers", () => {
  const files = parseDiff(DIFF);
  expect(files.map((f) => [f.path, f.oldPath, f.status, f.binary])).toEqual([
    ["README.md", "README.md", "modified", false],
    ["docs/b.md", "docs/specs/a.md", "renamed", false],
    ["mods/.gitkeep", "mods/.gitkeep", "deleted", false],
    ["new.js", null, "added", false],
    ["logo.png", "logo.png", "modified", true],
  ]);
  const r = files[0];
  expect([r.additions, r.deletions]).toEqual([3, 2]);
  expect(r.rows.map((x) => [x.kind, x.old, x.new, x.hunk])).toEqual([
    ["hunk", null, null, 0], ["context", 1, 1, 0], ["del", 2, null, 0], ["add", null, 2, 0], ["add", null, 3, 0], ["context", 3, 4, 0],
    ["hunk", null, null, 1], ["del", 10, null, 1], ["add", null, 11, 1], ["context", 11, 12, 1],
  ]);
  expect(files[3].rows.at(-1)).toMatchObject({ kind: "add", new: 2, text: "b" });
});

test("selectRange: side, hunk clamp, skips other side", () => {
  const rows = parseDiff(DIFF)[0].rows;
  // context 1 → add 3: RIGHT, the deleted line in between has no new number
  expect(selectRange(rows, 1, 4)).toEqual({ side: "RIGHT", start: 1, end: 3, from: 1, to: 4 });
  // dragging upward works the same
  expect(selectRange(rows, 4, 1)).toEqual({ side: "RIGHT", start: 1, end: 3, from: 1, to: 4 });
  // anchor on a deleted line: LEFT, adds are skipped, context has old numbers
  expect(selectRange(rows, 2, 5)).toEqual({ side: "LEFT", start: 2, end: 3, from: 2, to: 5 });
  // never crosses into the next hunk
  expect(selectRange(rows, 3, 9)).toMatchObject({ side: "RIGHT", start: 2, end: 4, to: 5 });
  expect(selectRange(rows, 0)).toBeNull();
});

test("commentPayload: single and multi-line", () => {
  expect(commentPayload("a.js", { side: "RIGHT", start: 4, end: 4 })).toEqual({ path: "a.js", line: 4, side: "RIGHT" });
  expect(commentPayload("a.js", { side: "LEFT", start: 2, end: 5 })).toEqual({ path: "a.js", line: 5, side: "LEFT", start_line: 2, start_side: "LEFT" });
});

test("anchorThreads: by side and line; an outdated one on its carried line, else loose; resolved ones keep their line", () => {
  const rows = parseDiff(DIFF)[0].rows;
  const t = (id, line, diffSide, more) => ({ id, line, diffSide, ...more });
  const { at, loose } = anchorThreads(rows, [t("r", 3, "RIGHT"), t("l", 2, "LEFT"), t("c", 1, "LEFT"), t("o", null, "RIGHT"), t("gone", 99, "RIGHT"),
    t("moved", null, "RIGHT", { isOutdated: true, carried: 12 }), t("res", 4, "RIGHT", { isResolved: true }), t("nowhere", null, "RIGHT", { carried: null })]);
  expect([...at].map(([i, ts]) => [i, ts.map((x) => x.id)])).toEqual([[4, ["r"]], [2, ["l"]], [1, ["c"]], [9, ["moved"]], [5, ["res"]]]);
  expect(loose.map((x) => x.id)).toEqual(["o", "gone", "nowhere"]);
});

// Old file 1..20; the new one adds two lines after 3, turns 8 and 9 into 8a, 8b, and adds one after 18.
const CARRY = parseDiff(["diff --git a/f b/f", "@@ -2,3 +2,5 @@", " l2", " l3", "+n1", "+n2", " l4", "@@ -7,4 +9,4 @@", " l7", "-l8", "-l9", "+l8a", "+l8b", " l10",
  "@@ -18,0 +21 @@", "+tail"].join("\n"))[0].rows;

test("carryLine: an old-side line through a diff to the line holding it now", () => {
  expect(carryLine(CARRY, 1)).toBe(1); // above every hunk
  expect(carryLine(CARRY, 3)).toBe(3); // context
  expect(carryLine(CARRY, 4)).toBe(6); // shifted by the two lines added above
  expect(carryLine(CARRY, 6)).toBe(8); // between hunks: the running offset
  expect(carryLine(CARRY, 8)).toBe(10); // deleted: the next new-side line in its hunk (what replaced it)
  expect(carryLine(CARRY, 9)).toBe(10);
  expect(carryLine(CARRY, 18)).toBe(20); // an addition after 18 (-18,0) leaves 18 above it
  expect(carryLine(CARRY, 19)).toBe(22); // past the last hunk: the offset after it
  expect(carryLine([], 7)).toBe(7); // the file didn't change
  expect(carryLine(CARRY, null)).toBe(null);
  const end = parseDiff(["diff --git a/f b/f", "@@ -4,2 +4 @@", " a", "-gone"].join("\n"))[0].rows;
  expect(carryLine(end, 5)).toBe(null); // deleted with nothing after it in the hunk
});

test("carryThreads: outdated new-side threads carried through the compare from the commit they were written on", () => {
  const th = (id, more) => ({ id, path: "f", line: null, diffSide: "RIGHT", isOutdated: true, originalLine: 4, comments: [{ originalCommit: { oid: "A" } }], ...more });
  const on = (oid) => ({ comments: [{ originalCommit: { oid } }] });
  const patch = ["@@ -2,3 +2,5 @@", " l2", " l3", "+n1", "+n2", " l4"].join("\n");
  const cmp = { A: { status: "ahead", files: [{ path: "f", oldPath: "f", patch }] }, F: { status: "diverged", files: [] },
    B: { status: "ahead", files: [{ path: "f", oldPath: "f", patch: null }] }, U: { status: "ahead", files: [] } };
  const out = carryThreads([th("a"), th("now", { line: 3 }), th("left", { diffSide: "LEFT" }), th("forced", on("F")), th("big", on("B")), th("same", on("U")),
    th("unknown", on("X")), th("gl", { comments: [{}] })], (oid) => cmp[oid] ?? null);
  expect(out.map((t) => [t.id, t.carried])).toEqual([["a", 6], ["now", null], ["left", null], ["forced", null], ["big", null], ["same", 4], ["unknown", null], ["gl", null]]);
  const capped = { status: "ahead", files: Array.from({ length: 300 }, (_, i) => ({ path: `x${i}`, oldPath: `x${i}`, patch: "" })) };
  expect(carryThreads([th("past-cap")], () => capped)[0].carried).toBe(null); // the compare lists 300 files at most: one left out may have changed
  expect(toCarry(th("a"))).toBe("A");
  expect(toCarry(th("now", { line: 3 }))).toBe(null);
  expect(toCarry(th("gl", { comments: [{}] }))).toBe(null);
});

test("settle: threads fetched at a head go on the diff only once it was taken at that head", () => {
  const next = { at: "H2", threads: ["new"] };
  expect(settle({ at: "H1", next })).toEqual({}); // the diff shown is older: the threads wait
  expect(settle({ at: null, next })).toEqual({}); // the diff is still loading
  expect(settle({ at: "H2", next })).toEqual({ threads: ["new"], next: null });
  expect(settle({ at: "H2", next: null })).toEqual({});
});

test("threadLines: where a thread is now and, outdated, where it was", () => {
  expect(threadLines({ line: 5, startLine: null })).toEqual({ at: "Line 5", was: null });
  expect(threadLines({ line: 7, startLine: 5 })).toEqual({ at: "Lines 5–7", was: null });
  expect(threadLines({ line: null, carried: 22, isOutdated: true, originalLine: 13 })).toEqual({ at: "Line 22", was: "was line 13" });
  expect(threadLines({ line: null, carried: null, isOutdated: true, originalLine: 13, originalStartLine: 11 })).toEqual({ at: null, was: "was lines 11–13" });
  expect(threadLines({ line: null, isOutdated: true })).toEqual({ at: null, was: null });
});

test("hunkTail: the last lines of a comment's diff hunk, header dropped, by kind", () => {
  expect(hunkTail("@@ -0,0 +1,5 @@\n+a\n+b\n c\n-d\n+e", 3)).toEqual([{ kind: "context", text: "c" }, { kind: "del", text: "d" }, { kind: "add", text: "e" }]);
  expect(hunkTail("@@ -1 +1 @@\n x")).toEqual([{ kind: "context", text: "x" }]);
  expect(hunkTail(undefined)).toEqual([]);
});

test("ago and firstVisible", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  expect(ago("2026-11-11T11:59:30Z", now)).toBe("now");
  expect(ago("2026-11-11T11:15:00Z", now)).toBe("45m");
  expect(ago("2026-11-09T12:00:00Z", now)).toBe("2d");
  expect(firstVisible([0, 20, 40, 60], [20, 20, 20, 20], 25)).toBe(1);
  expect(firstVisible([0, 20, 40, 60], [20, 20, 20, 20], 0)).toBe(0);
  expect(firstVisible([0, 20], [20, 20], 100)).toBe(2);
});

test("pairRows: context on both sides, deletions pair with the additions after them, the rest blank", () => {
  const k = (s) => [...s].map((c) => ({ kind: { h: "hunk", c: "context", d: "del", a: "add" }[c] }));
  expect(pairRows(k("hcddac"))).toEqual([{ hunk: 0 }, { l: 1, r: 1 }, { l: 2, r: 4 }, { l: 3, r: null }, { l: 5, r: 5 }]);
  expect(pairRows(k("aadda"))).toEqual([{ l: null, r: 0 }, { l: null, r: 1 }, { l: 2, r: 4 }, { l: 3, r: null }]);
});

test("commentPayload: both line numbers of the chosen rows and the old path ride along (GitLab needs them)", () => {
  const rows = [{ kind: "hunk" }, { kind: "del", old: 3, new: null }, { kind: "context", old: 4, new: 6 }, { kind: "add", old: null, new: 7 }];
  const one = commentPayload("a.py", { side: "RIGHT", start: 6, end: 6, from: 2, to: 2 }, rows, null);
  expect(one).toMatchObject({ path: "a.py", line: 6, side: "RIGHT", old_path: "a.py", anchor: { start: { old: 4, new: 6 }, end: { old: 4, new: 6 } } });
  expect("start_line" in one).toBe(false);
  const range = commentPayload("b.py", { side: "RIGHT", start: 6, end: 7, from: 2, to: 3 }, rows, "old/b.py");
  expect(range).toMatchObject({ start_line: 6, line: 7, old_path: "old/b.py", anchor: { start: { old: 4, new: 6 }, end: { old: null, new: 7 } } });
});

test("parseDiff: git's quoted names (octal UTF-8) and the tab after a name with a space", () => {
  const files = parseDiff([
    'diff --git "a/docs/new file \\303\\251.md" "b/docs/new file \\303\\251.md"', "new file mode 100644", "--- /dev/null", '+++ "b/docs/new file \\303\\251.md"\t', "@@ -0,0 +1 @@", "+x",
    "diff --git a/CLAUDE.md b/docs/CLAUDE guide.md", "similarity index 99%", "rename from CLAUDE.md", "rename to docs/CLAUDE guide.md", "--- a/CLAUDE.md", "+++ b/docs/CLAUDE guide.md\t", "@@ -1 +1,2 @@", " a", "+b",
    "diff --git a/my notes.md b/my notes.md", "--- a/my notes.md\t", "+++ b/my notes.md\t", "@@ -1 +1 @@", "-a", "+b",
    'diff --git "a/q\\"t\\\\ab.md" "b/q\\"t\\\\ab.md"', '--- "a/q\\"t\\\\ab.md"', '+++ "b/q\\"t\\\\ab.md"', "@@ -1 +1 @@", "-a", "+b",
  ].join("\n"));
  expect(files.map((f) => [f.status, f.oldPath, f.path])).toEqual([
    ["added", null, "docs/new file é.md"], ["renamed", "CLAUDE.md", "docs/CLAUDE guide.md"], ["modified", "my notes.md", "my notes.md"], ["modified", 'q"t\\ab.md', 'q"t\\ab.md']]);
});

test("commentPayload: each end's place on both sides, as GitLab names a line (the side it isn't on: the next line there)", () => {
  const [f, added] = parseDiff([
    "diff --git a/R.md b/R.md", "@@ -6,9 +6,10 @@", " six", "-seven", "+SEVEN", " eight", "-nine", "+NINE", "+ten", " ten", " eleven", " twelve", "-thirteen", "+THIRTEEN",
    "diff --git a/n.md b/n.md", "new file mode 100644", "--- /dev/null", "+++ b/n.md", "@@ -0,0 +1,2 @@", "+one", "+two",
  ].join("\n"));
  const pos = (file, from, to) => { const a = commentPayload(file.path, selectRange(file.rows, from, to), file.rows).anchor; return [a.start.pos, a.end.pos]; };
  expect(pos(f, 2, 2)).toEqual([[7, 7], [7, 7]]); // -seven
  expect(pos(f, 6, 8)).toEqual([[10, 9], [10, 11]]); // +NINE … " ten" (old 10, new 11)
  expect(pos(f, 11, 9)).toEqual([[11, 12], [13, 14]]); // " eleven" … -thirteen
  expect(pos(added, 1, 2)).toEqual([[0, 1], [0, 2]]);
});

test("tabArrows: ← / → walk Open · Closed · All only while ↑ / ↓ walk the PR list, never while they walk a PR's files", () => {
  expect(tabArrows({ listShows: true, filesOpen: false, inSearch: false })).toBe(true);  // the list has the arrows
  expect(tabArrows({ listShows: true, filesOpen: true, inSearch: false })).toBe(false);  // the rail shows, but ↑ / ↓ walk files
  expect(tabArrows({ listShows: false, filesOpen: false, inSearch: false })).toBe(false); // the list isn't on screen
  expect(tabArrows({ listShows: true, filesOpen: false, inSearch: true })).toBe(false);  // the search box takes ← / → for its caret
});
