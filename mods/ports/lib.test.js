import { test, expect } from "bun:test";
import { parseLsof, parseCwds, parsePs, parseEtime, slug, scratchSlug, ownerContext, owner,
  urlFor, isWeb, servers, sortServers, holds, ago, blockHeight } from "./lib.js";
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

// ---- Servers ----

const L = (pid, host, port, command = "node") => ({ pid, command, host, port });
const noCtx = () => ownerContext({ terminals: [], roots: new Map(), home: HOME });

test("urlFor: the address the server is actually on", () => {
  expect(urlFor(["*"], 5173)).toBe("http://localhost:5173");
  expect(urlFor(["127.0.0.1", "[::1]"], 5173)).toBe("http://localhost:5173");
  expect(urlFor(["127.0.0.1"], 8000)).toBe("http://127.0.0.1:8000");
  expect(urlFor(["[::1]"], 3000)).toBe("http://[::1]:3000");
  expect(urlFor(["100.64.0.7"], 8080)).toBe("http://100.64.0.7:8080");
});

test("isWeb: databases and debuggers aren't web", () => {
  expect(isWeb(5432, "/opt/homebrew/bin/postgres")).toBe(false);
  expect(isWeb(9229, "node")).toBe(false);
  expect(isWeb(6380, "/usr/local/bin/redis-server")).toBe(false);
  expect(isWeb(5173, "node")).toBe(true);
});

test("servers: uvicorn --reload's two pids on one port are one row, the supervisor's (Review Focus 5)", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/a", { program: { agent: false } })], roots: new Map(), home: HOME });
  const rows = servers({ listeners: [L(100, "127.0.0.1", 8000, "Python"), L(101, "127.0.0.1", 8000, "Python")],
    procs: procs([300, 200], [100, 300, "uvicorn"], [101, 100, "python"]), cwds: new Map(), ctx, home: HOME });
  expect(rows.map((r) => [r.pid, r.port])).toEqual([[100, 8000]]);
  expect(rows[0].owner).toEqual({ kind: "sure", address: "t1" });
});

test("servers: the same port number on unrelated pids is two rows, each with its own address", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 210, "/w/a"), term("t2", 300, 310, "/w/b")], roots: new Map(), home: HOME });
  const rows = servers({ listeners: [L(400, "127.0.0.1", 3000), L(500, "[::1]", 3000)],
    procs: procs([400, 210], [500, 310], [210, 200], [310, 300]), cwds: new Map(), ctx, home: HOME });
  expect(rows.map((r) => r.url).sort()).toEqual(["http://127.0.0.1:3000", "http://[::1]:3000"]);
});

test("servers: the agent's own port is hidden; a shell's foreground dev server is kept", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 300, "/w/a"), term("t2", 210, 310, "/w/b", { program: { agent: false } })],
    roots: new Map(), home: HOME });
  const rows = servers({ listeners: [L(300, "127.0.0.1", 51304, "2.1.325"), L(310, "*", 5173)],
    procs: procs([300, 200], [310, 210]), cwds: new Map(), ctx, home: HOME });
  expect(rows.map((r) => r.port)).toEqual([5173]);
});

test("servers: orphans only under home or tmp and not an agent binary (rapportd, ControlCenter dropped)", () => {
  const rows = servers({ listeners: parseLsof(LSOF), procs: parsePs(PS), cwds: parseCwds(CWDS), ctx: noCtx(), home: "/Users/shoaib" });
  expect(rows.map((r) => [r.pid, r.port])).toEqual([[8035, 18791], [8035, 18792]]);
  expect(rows[0].owner.kind).toBe("orphan");
  expect(rows[0].command).toBe("Python");
  const agentBin = servers({ listeners: [L(9940, "127.0.0.1", 4000)], procs: parsePs(PS), cwds: new Map([[9940, "/Users/shoaib/x"]]),
    ctx: noCtx(), home: "/Users/shoaib" });
  expect(agentBin).toEqual([]);
});

test("servers: docker's ports are kept though its folder is /", () => {
  const rows = servers({ listeners: [L(77, "*", 5432, "com.docke")], procs: procs([77, 1, "/Applications/Docker.app/Contents/MacOS/com.docker.backend"]),
    cwds: new Map([[77, "/"]]), ctx: noCtx(), home: HOME });
  expect(rows.map((r) => [r.port, r.owner.kind, r.web])).toEqual([[5432, "docker", false]]);
});

test("servers: one row per pid+port with hosts merged; ports lists every port of the pid; network flag", () => {
  const ctx = ownerContext({ terminals: [term("t1", 200, 210, "/w/a")], roots: new Map(), home: HOME });
  const rows = servers({ listeners: [L(400, "127.0.0.1", 5173), L(400, "[::1]", 5173), L(400, "*", 24678)],
    procs: procs([400, 210], [210, 200]), cwds: new Map(), ctx, home: HOME });
  expect(rows.map((r) => [r.port, r.url, r.network, r.ports])).toEqual([
    [5173, "http://localhost:5173", false, [5173, 24678]],
    [24678, "http://localhost:24678", true, [5173, 24678]],
  ]);
  expect(rows[0].key).toBe("400:5173");
});

test("sortServers: owned by port, then orphans oldest first; input not mutated", () => {
  const r = (port, kind, age) => ({ port, age, owner: { kind } });
  const input = [r(9000, "orphan", 10), r(8000, "sure", 1), r(9001, "orphan", 99), r(3000, "probable", 5), r(5432, "docker", 1)];
  const copy = [...input];
  expect(sortServers(input).map((x) => x.port)).toEqual([3000, 5432, 8000, 9001, 9000]);
  expect(input).toEqual(copy);
});

test("holds: true only while that pid holds that port (Review Focus 3)", () => {
  const l = parseLsof(LSOF);
  expect(holds(l, 1093, 24543)).toBe(true);
  expect(holds(l, 1093, 5173)).toBe(false);
  expect(holds(l, 99999, 24543)).toBe(false);
});

test("ago: now, minutes, hours, days", () => {
  expect([ago(30), ago(12 * 60), ago(3 * 3600 + 5), ago(2 * 86400)]).toEqual(["now", "12m", "3h", "2d"]);
});

test("blockHeight: from the row count alone (no measured size to chase); 0 folded; capped rows", () => {
  expect(blockHeight(0, true)).toBe(0);
  expect(blockHeight(3, true)).toBe(0);
  expect(blockHeight(0, false)).toBe(32);
  expect(blockHeight(2, false)).toBe(41 + 2 * 30);
  expect(blockHeight(9, false)).toBe(41 + 5 * 30);
});
