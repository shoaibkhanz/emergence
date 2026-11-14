import { test, expect } from "bun:test";
import { parseLsof, parseCwds, parsePs, parseEtime, slug, scratchSlug, ownerContext, owner } from "./lib.js";
import { LSOF, CWDS, PS, SCRATCH } from "./fixtures.js";

test("parseLsof: one entry per pid+host+port; IPv4/IPv6 sockets of one pid kept apart by host", () => {
  const l = parseLsof(LSOF);
  expect(l.filter((x) => x.pid === 745)).toEqual([{ pid: 745, command: "rapportd", host: "*", port: 49261 }]);
  expect(l.find((x) => x.pid === 1093)).toEqual({ pid: 1093, command: "moshi-hook", host: "127.0.0.1", port: 24543 });
  expect(l.find((x) => x.port === 3000).host).toBe("[::1]");
  expect(l.filter((x) => x.pid === 796).map((x) => x.port)).toEqual([7000, 5000]);
});

test("parseLsof: ignores non-socket name lines (a path from a broader lsof query)", () => {
  expect(parseLsof("p1\ncx\nftxt\nn/usr/lib/dyld\nfcwd\nn/\n")).toEqual([]);
});

test("parsePs: comm keeps its spaces; etime forms", () => {
  expect(parsePs(PS).get(9940)).toEqual({ pid: 9940, ppid: 9939, age: 12 * 3600 + 29 * 60 + 59,
    comm: "/Users/shoaib/Library/Application Support/Claude/claude-code/2.1.325/485fdac4332e/claude.app/Contents/MacOS/claude" });
  expect(parseEtime("03:21")).toBe(201);
  expect(parseEtime("12:29:59")).toBe(12 * 3600 + 29 * 60 + 59);
  expect(parseEtime("05-14:20:36")).toBe(5 * 86400 + 14 * 3600 + 20 * 60 + 36);
});

test("parseCwds: pid -> folder", () => {
  const c = parseCwds(CWDS);
  expect(c.get(745)).toBe("/");
  expect(c.get(8035)).toMatch(/scratchpad\/spike$/);
});

test("parsers: empty or garbage input gives empty results, never throws", () => {
  expect(parseLsof("")).toEqual([]);
  expect(parsePs("x y\n").size).toBe(0);
  expect(parseCwds("").size).toBe(0);
  expect(parseEtime("garbage")).toBe(0);
});

// ---- Ownership ----

const HOME = "/Users/me";
const term = (address, pid, fgPid, folder, extra = {}) => ({ address, state: "live", machine: null, pid,
  foreground: { pid: fgPid, cwd: folder }, cwd: folder, program: { agent: true }, status_ms: 0, ...extra });
const procs = (...rows) => new Map(rows.map(([pid, ppid, comm = "x"]) => [pid, { pid, ppid, age: 60, comm }]));

test("owner: sure through the parent chain, from a grandchild of the agent", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/a")], roots: new Map([["/w/a", "/w/a"]]), home: HOME });
  const ps = procs([200, 1], [300, 200], [400, 300], [500, 400]);
  expect(owner(500, ps, "/somewhere/else", ctx)).toEqual({ kind: "sure", address: "t1" });
  expect(owner(300, ps, "/w/a", ctx)).toEqual({ kind: "sure", address: "t1" }); // the agent process itself
});

test("owner: parent pid 1 inside an agent's worktree is probable (Review Focus 2)", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/a/src")], roots: new Map([["/w/a/src", "/w/a"]]), home: HOME });
  expect(owner(8035, procs([8035, 1]), "/w/a/web", ctx)).toEqual({ kind: "probable", address: "t1" });
  expect(owner(8035, procs([8035, 1]), "/w/ab", ctx)).toEqual({ kind: "orphan", address: null }); // a sibling folder, not inside
});

test("owner: nested worktree beats the main checkout that contains it", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/a"), term("t2", 210, 310, "/w/a/.claude/worktrees/x")],
    roots: new Map([["/w/a", "/w/a"], ["/w/a/.claude/worktrees/x", "/w/a/.claude/worktrees/x"]]), home: HOME });
  expect(owner(8035, procs([8035, 1]), "/w/a/.claude/worktrees/x/app", ctx)).toEqual({ kind: "probable", address: "t2" });
  expect(owner(8035, procs([8035, 1]), "/w/a/app", ctx)).toEqual({ kind: "probable", address: "t1" });
});

test("owner: two agents in one worktree: the one that changed most recently", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/a", { status_ms: 5 }), term("t2", 210, 310, "/w/a", { status_ms: 9 })],
    roots: new Map([["/w/a", "/w/a"]]), home: HOME });
  expect(owner(8035, procs([8035, 1]), "/w/a", ctx)).toEqual({ kind: "probable", address: "t2" });
});

test("owner: an agent in ~ or in a dotfiles repo at ~ claims nothing (Review Focus 1)", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, HOME), term("t2", 210, 310, `${HOME}/.config`)],
    roots: new Map([[HOME, null], [`${HOME}/.config`, HOME]]), home: HOME });
  expect(owner(8035, procs([8035, 1]), `${HOME}/code/x`, ctx)).toEqual({ kind: "orphan", address: null });
});

test("owner: an agent in a folder that isn't a repo matches only that exact folder", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/notes")], roots: new Map([["/w/notes", null]]), home: HOME });
  expect(owner(8035, procs([8035, 1]), "/w/notes", ctx)).toEqual({ kind: "probable", address: "t1" });
  expect(owner(8035, procs([8035, 1]), "/w/notes/sub", ctx)).toEqual({ kind: "orphan", address: null });
});

test("owner: Claude scratchpad matches the agent whose folder slugs to it", () => {
  const wt = "/Users/shoaib/code/experiments/margo/.claude/worktrees/ai-artifacts-research-6b95a0";
  expect(slug(wt)).toBe("-Users-shoaib-code-experiments-margo--claude-worktrees-ai-artifacts-research-6b95a0");
  expect(scratchSlug(SCRATCH)).toBe(slug(wt));
  expect(scratchSlug("/Users/me/claude-501/x/y")).toBe(null); // not under a temp folder
  const ctx = ownerContext({ terminals: [term("t2", 210, 310, wt)], roots: new Map([[wt, wt]]), home: "/Users/shoaib" });
  expect(owner(8035, parsePs(PS), SCRATCH, ctx)).toEqual({ kind: "probable", address: "t2" });
});

test("owner: a remote terminal with the same pid claims nothing (Review Focus 4)", () => {
  const ctx = ownerContext({ terminals: [term("box:t9", 200, 300, "/w/a", { machine: "box" })], roots: new Map([["/w/a", "/w/a"]]), home: HOME });
  expect(owner(400, procs([400, 300], [300, 200], [200, 1]), "/w/a", ctx)).toEqual({ kind: "orphan", address: null });
});

test("owner: finished terminals claim nothing", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/a", { state: "finished" })], roots: new Map([["/w/a", "/w/a"]]), home: HOME });
  expect(owner(300, procs([300, 200], [200, 1]), "/w/a", ctx).kind).toBe("orphan");
});

test("owner: docker by its process name; a parent cycle or missing parent ends the walk", () => {
  const ctx = ownerContext({ terminals: [], roots: new Map(), home: HOME });
  expect(owner(77, procs([77, 1, "/Applications/Docker.app/Contents/MacOS/com.docker.backend"]), "/", ctx)).toEqual({ kind: "docker", address: null });
  expect(owner(5, procs([5, 6], [6, 5]), "/", ctx)).toEqual({ kind: "orphan", address: null });
  expect(owner(5, procs([5, 999]), undefined, ctx)).toEqual({ kind: "orphan", address: null });
});
