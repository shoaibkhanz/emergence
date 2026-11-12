import { test, expect } from "bun:test";
import { parseDiff, selectRange, commentPayload, anchorThreads, ago, firstVisible, fileTree, tagBody, splitTag } from "./lib.js";

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

test("anchorThreads: by side and line, outdated loose", () => {
  const rows = parseDiff(DIFF)[0].rows;
  const t = (id, line, diffSide) => ({ id, line, diffSide });
  const { at, loose } = anchorThreads(rows, [t("r", 3, "RIGHT"), t("l", 2, "LEFT"), t("c", 1, "LEFT"), t("o", null, "RIGHT"), t("gone", 99, "RIGHT")]);
  expect([...at].map(([i, ts]) => [i, ts.map((x) => x.id)])).toEqual([[4, ["r"]], [2, ["l"]], [1, ["c"]]]);
  expect(loose.map((x) => x.id)).toEqual(["o", "gone"]);
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
