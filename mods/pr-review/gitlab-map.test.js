import { test, expect } from "bun:test";
import { forgeOrder, mapMR, glStates, mapThreads, commitDiffText, position, versionFor } from "./gitlab-map.js";
import { parseDiff } from "./lib.js";

test("mapMR: GitLab fields to the PR shape; counts unknown", () => {
  expect(mapMR({ iid: 7, title: "T", state: "opened", draft: false, author: { username: "sk" }, updated_at: "2026-11-01T00:00:00Z", source_branch: "feature/x", target_branch: "main" }))
    .toEqual({ number: 7, title: "T", state: "OPEN", isDraft: false, author: { login: "sk" }, additions: null, deletions: null, updatedAt: "2026-11-01T00:00:00Z", headRefName: "feature/x", baseRefName: "main" });
  expect(mapMR({ iid: 1, state: "merged", author: {} }).state).toBe("MERGED");
  expect(mapMR({ iid: 2, state: "closed", author: {} }).state).toBe("CLOSED");
});

test("glStates: closed includes merged, as gh's does", () => {
  expect(glStates("closed")).toEqual(["closed", "merged"]);
  expect(glStates("open")).toEqual(["opened"]);
  expect(glStates("merged")).toEqual(["merged"]);
  expect(glStates("all")).toEqual(["all"]);
});

const MR = { iid: 7, description: "What this does", created_at: "2026-11-01T09:00:00Z", author: { username: "sk" }, diff_refs: { base_sha: "B", start_sha: "S", head_sha: "H2" } };
const note = (id, extra) => ({ id, body: `note ${id}`, author: { username: "sk" }, created_at: `2026-11-01T1${id}:00:00Z`, system: false, ...extra });

test("mapThreads: diff notes become threads, other notes the talk, system notes dropped", () => {
  const discussions = [
    { id: "d1", individual_note: false, notes: [
      note(1, { type: "DiffNote", resolvable: true, resolved: true, position: { new_path: "src/a.py", old_path: "src/a.py", new_line: 12, old_line: null, head_sha: "H1" } }),
      note(2, { type: "DiffNote", resolvable: true, resolved: true, author: { username: "bob" }, position: { new_path: "src/a.py", old_path: "src/a.py", new_line: 12, old_line: null, head_sha: "H1" } })] },
    { id: "d2", individual_note: true, notes: [note(3, { type: null })] },
    { id: "d3", individual_note: true, notes: [note(4, { system: true, body: "added 2 commits" })] },
  ];
  const r = mapThreads(discussions, MR, "sk");
  expect(r.headOid).toBe("H2");
  expect(r.threads).toHaveLength(1);
  expect(r.threads[0]).toMatchObject({ id: "d1", isResolved: true, isOutdated: true, path: "src/a.py", line: null, diffSide: "RIGHT", startLine: null }); // outdated: shown apart, as GitHub (line null)
  expect(r.threads[0].comments[0]).toEqual({ id: 1, databaseId: 1, body: "note 1", author: { login: "sk" }, createdAt: "2026-11-01T11:00:00Z", viewerCanUpdate: true, viewerCanDelete: true });
  expect(r.threads[0].comments[1]).toMatchObject({ author: { login: "bob" }, viewerCanUpdate: false, viewerCanDelete: false });
  expect(r.talk.map((t) => t.kind)).toEqual(["body", "comment"]);
  expect(r.talk[0]).toMatchObject({ id: "body", body: "What this does", author: "sk" });
  expect(r.talk[1]).toMatchObject({ databaseId: 3, author: "sk", viewerCanUpdate: true });
  expect(JSON.stringify(r)).not.toContain("added 2 commits");
});

test("mapThreads: a removed-line note is LEFT on old_line; a ranged note has startLine; current head isn't outdated", () => {
  const d = (id, position) => ({ id, individual_note: false, notes: [note(1, { type: "DiffNote", resolvable: true, resolved: false, position: { head_sha: "H2", new_path: "a.py", old_path: "a.py", ...position } })] });
  const [left, ranged] = mapThreads([d("x", { old_line: 5, new_line: null }), d("y", { new_line: 12, old_line: null, line_range: { start: { new_line: 10, old_line: null }, end: { new_line: 12, old_line: null } } })], MR, "sk").threads;
  expect(left).toMatchObject({ diffSide: "LEFT", line: 5, isOutdated: false, isResolved: false });
  expect(ranged).toMatchObject({ diffSide: "RIGHT", line: 12, startLine: 10 });
});

test("commitDiffText: modified, new, deleted and renamed files parse back", () => {
  const files = parseDiff(commitDiffText([
    { old_path: "a.py", new_path: "a.py", diff: "@@ -1,2 +1,2 @@\n-x\n+y\n z\n" },
    { old_path: "b.py", new_path: "b.py", new_file: true, diff: "@@ -0,0 +1 @@\n+new\n" },
    { old_path: "c.py", new_path: "c.py", deleted_file: true, diff: "@@ -1 +0,0 @@\n-gone\n" },
    { old_path: "old.py", new_path: "new.py", renamed_file: true, diff: "@@ -1 +1 @@\n-a\n+b\n" },
  ]));
  expect(files.map((f) => f.path)).toEqual(["a.py", "b.py", "c.py", "new.py"]);
  expect(files[3].oldPath).toBe("old.py");
  expect([files[0].additions, files[0].deletions]).toEqual([1, 1]);
  expect([files[1].status, files[2].status]).toEqual(["added", "deleted"]);
});

const V = { base_commit_sha: "B", start_commit_sha: "S", head_commit_sha: "H" };
const at = (old, nu, extra = {}) => ({ path: "src/a.py", old_path: "src/a.py", side: nu == null ? "LEFT" : "RIGHT", line: nu ?? old, anchor: { start: { old, new: nu }, end: { old, new: nu } }, ...extra });

test("position: added, removed and unchanged lines; SHAs from the version", () => {
  expect(position(at(null, 8), V, null)).toEqual({ base_sha: "B", start_sha: "S", head_sha: "H", position_type: "text", new_path: "src/a.py", old_path: "src/a.py", new_line: 8 });
  expect(position(at(5, null), V, null)).toEqual({ base_sha: "B", start_sha: "S", head_sha: "H", position_type: "text", new_path: "src/a.py", old_path: "src/a.py", old_line: 5 });
  expect(position(at(4, 6), V, null)).toMatchObject({ old_line: 4, new_line: 6 });
});

test("position: a range adds line_range with line codes", () => {
  const p = { ...at(null, 12), start_line: 10, anchor: { start: { old: null, new: 10, pos: [9, 10] }, end: { old: null, new: 12, pos: [9, 12] } } };
  const pos = position(p, V, (o, n) => `P_${o}_${n}`);
  expect(pos.line_range).toEqual({ start: { line_code: "P_9_10", type: "new", old_line: null, new_line: 10 }, end: { line_code: "P_9_12", type: "new", old_line: null, new_line: 12 } });
  expect(pos.new_line).toBe(12);
});

test("versionFor: the matching version, else the newest", () => {
  const vs = [{ head_commit_sha: "H2" }, { head_commit_sha: "H1" }];
  expect(versionFor(vs, "H1")).toBe(vs[1]);
  expect(versionFor(vs, "nope")).toBe(vs[0]);
});

test("mapThreads: a range stored as line codes only (as GitLab returns it) still gives its start line", () => {
  const d = { id: "r", individual_note: false, notes: [note(1, { type: "DiffNote", resolvable: true, resolved: false, position: { head_sha: "H2", new_path: "a.py", old_path: "a.py", old_line: 8, new_line: 8,
    line_range: { start: { line_code: "8ec9_7", type: "new" }, end: { line_code: "8ec9_8_8", type: "new" } } } })] };
  d.notes[0].position.line_range.start.line_code = "8ec9a00b__7";
  expect(mapThreads([d], MR, "sk").threads[0]).toMatchObject({ line: 8, startLine: 7, diffSide: "RIGHT" });
});

test("forgeOrder: the likely forge first, the other as fallback (GitHub Enterprise or an alias has no 'github' in it)", () => {
  expect(forgeOrder("https://github.com/a/b.git")).toEqual(["github", "gitlab"]);
  expect(forgeOrder("git@github.com:a/b.git")).toEqual(["github", "gitlab"]);
  expect(forgeOrder("https://gitlab.com/neatly-health-agents/agent-factory.git")).toEqual(["gitlab", "github"]);
  expect(forgeOrder("git@ghe-corp:team/app.git")).toEqual(["gitlab", "github"]);
  expect(forgeOrder("")).toEqual(["gitlab", "github"]);
});

const ranged = (position) => mapThreads([{ id: "r", individual_note: false, notes: [note(1, { type: "DiffNote", resolvable: true, resolved: false, position: { head_sha: "H2", new_path: "a.py", old_path: "a.py", ...position } })] }], MR, "sk").threads[0];

test("mapThreads: a range reads both ends on one side: the old numbers when it ends on a removed line or begins on one", () => {
  // begins on an unchanged line (old 12, new 13), ends on a removed one (old 14)
  expect(ranged({ old_line: 14, new_line: null, line_range: { start: { line_code: "8ec9_12_13", type: "new" }, end: { line_code: "8ec9_14_", type: "old" } } }))
    .toMatchObject({ diffSide: "LEFT", line: 14, startLine: 12 });
  expect(ranged({ old_line: 14, new_line: null, line_range: { start: { line_code: "8ec9_12_13", old_line: 12, new_line: 13 }, end: { line_code: "8ec9_14_", old_line: 14, new_line: null } } }))
    .toMatchObject({ diffSide: "LEFT", line: 14, startLine: 12 });
  // begins on a removed line (old 9), ends on an unchanged one (old 10, new 11)
  expect(ranged({ old_line: 10, new_line: 11, line_range: { start: { line_code: "8ec9_9_", type: "old" }, end: { line_code: "8ec9_10_11", type: "new" } } }))
    .toMatchObject({ diffSide: "LEFT", line: 10, startLine: 9 });
  // new side throughout, begun on an unchanged line
  expect(ranged({ old_line: null, new_line: 15, line_range: { start: { line_code: "8ec9_12_13", type: "new" }, end: { line_code: "8ec9__15", type: "new" } } }))
    .toMatchObject({ diffSide: "RIGHT", line: 15, startLine: 13 });
});

test("position: a range's ends carry their line numbers too (GitLab's own page reads them), an unchanged line with no type", () => {
  const p = { ...at(9, null), start_line: 8, anchor: { start: { old: 8, new: 8, pos: [8, 8] }, end: { old: 9, new: null, pos: [9, 9] } } };
  expect(position(p, V, (o, n) => `P_${o}_${n}`).line_range).toEqual({
    start: { line_code: "P_8_8", type: null, old_line: 8, new_line: 8 }, end: { line_code: "P_9_9", type: "old", old_line: 9, new_line: null } });
});
