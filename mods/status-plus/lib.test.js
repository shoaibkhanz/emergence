import { test, expect } from "bun:test";
import { parseVmStat, memUsed, parseSysctl, parseSwap, parseDf, parseBattery, parseProcs, cpuSample,
  localTerminals, chainOwner, byAgent, visibleAgents, topProcs, level, segments, fmtBytes,
  worktreePaths, parseDu, portsByPid, splitAgents, chipPort } from "./lib.js";
import { VM_STAT, SYSCTL, SWAP, DF, BATT_ON, BATT_AC, PS } from "./fixtures.js";

test("parseVmStat + memUsed: (active + wired + compressor) pages at the stated page size", () => {
  const vm = parseVmStat(VM_STAT);
  expect(vm).toEqual({ page: 16384, active: 240599, wired: 155379, compressed: 358253 });
  expect(memUsed(vm)).toBe((240599 + 155379 + 358253) * 16384);
  expect(parseVmStat("")).toBe(null);
});

test("parseSysctl: total bytes, cores, pressure 1/2/4 as normal/warn/critical", () => {
  expect(parseSysctl(SYSCTL)).toEqual({ total: 17179869184, cores: 10, pressure: "normal" });
  expect(parseSysctl("1\n2\n2\n").pressure).toBe("warn");
  expect(parseSysctl("1\n2\n4\n").pressure).toBe("critical");
  expect(parseSysctl("")).toBe(null);
});

test("parseSwap: the used figure in bytes", () => {
  expect(parseSwap(SWAP)).toBe(Math.round(3709.31 * 1024 * 1024));
  expect(parseSwap("total = 0.00M  used = 0.00M  free = 0.00M")).toBe(0);
  expect(parseSwap("")).toBe(null);
});

test("parseDf: size and available KB from the last line", () => {
  expect(parseDf(DF)).toEqual({ size: 482797652, free: 14447236 });
  expect(parseDf("")).toBe(null);
});

test("parseBattery: on battery or AC, and the percent", () => {
  expect(parseBattery(BATT_ON)).toEqual({ onBattery: true, percent: 72 });
  expect(parseBattery(BATT_AC)).toEqual({ onBattery: false, percent: 100 });
  expect(parseBattery("No batteries")).toBe(null);
});

test("parseProcs: comm keeps its spaces; cpu time in seconds", () => {
  const p = parseProcs(PS);
  expect(p.get(9940)).toEqual({ pid: 9940, ppid: 9939, rss: 185280, cpu: 8 * 60 + 21.42,
    comm: "/Users/shoaib/Library/Application Support/Claude/claude-code/2.1.325/485fdac4332e/claude.app/Contents/MacOS/claude" });
  expect(p.get(1).cpu).toBeCloseTo(78 * 60 + 9.72, 5);
});

const procs = (...rows) => new Map(rows.map(([pid, cpu]) => [pid, { pid, ppid: 1, rss: 1, cpu, comm: "x" }]));

test("cpuSample: null on the first poll (Review Focus 1) and when no time passed", () => {
  expect(cpuSample(null, { at: 5000, procs: procs([1, 3]) }, 10)).toBe(null);
  expect(cpuSample({ at: 5000, procs: procs([1, 3]) }, { at: 5000, procs: procs([1, 4]) }, 10)).toBe(null);
});

test("cpuSample: two cores busy for 5 s on 10 cores is 20%; per pid as a share of the machine", () => {
  const s = cpuSample({ at: 0, procs: procs([1, 10], [2, 0]) }, { at: 5000, procs: procs([1, 15], [2, 5]) }, 10);
  expect(s.total).toBe(20);
  expect(s.byPid.get(1)).toBe(10);
});

test("cpuSample: a process started since the last poll counts all its time; a reused pid (time went down) counts as new; an exited one adds nothing (review: Important 1)", () => {
  const s = cpuSample({ at: 0, procs: procs([1, 10], [3, 99], [4, 7]) }, { at: 5000, procs: procs([1, 10], [2, 2], [3, 1]) }, 10);
  expect(s.byPid.get(2)).toBe(4);          // new: 2 s of its own in 5 s on 10 cores
  expect(s.byPid.get(3)).toBe(2);          // reused pid: its 1 s, not a negative
  expect(s.byPid.has(4)).toBe(false);      // exited between the polls
  expect(s.total).toBe(6);
});

test("cpuSample: no pid counts more than the whole interval on every core (a line ps skipped last time)", () => {
  const s = cpuSample({ at: 0, procs: procs([1, 0]) }, { at: 5000, procs: procs([1, 0], [2, 500]) }, 10);
  expect(s.byPid.get(2)).toBe(100);
  expect(s.total).toBe(100);
});

// ---- Sums, levels, segments ----

const P = (pid, ppid, rss = 1000, comm = "x") => [pid, { pid, ppid, rss, cpu: 0, comm }];
const term = (address, pid, fgPid, extra = {}) => ({ address, state: "live", machine: null, pid, foreground: { pid: fgPid }, parent: null, ...extra });

test("localTerminals: shell and agent pids of this computer's live terminals; sub-agents roll up to their parent", () => {
  const m = localTerminals([term("t1", 200, 300), term("t2", 210, 310, { parent: "t1" }), term("box/t9", 220, 320), term("t8", 230, 330, { machine: "box" }),
    term("t7", 240, 340, { state: "finished" })]);
  expect([...m.entries()].sort()).toEqual([[200, "t1"], [210, "t1"], [300, "t1"], [310, "t1"]].sort());
});

test("chainOwner: through a grandchild; a remote terminal's equal pid claims nothing (Review Focus 5); cycles end", () => {
  const procs = new Map([P(500, 400), P(400, 300), P(300, 200), P(200, 1), P(7, 8), P(8, 7)]);
  expect(chainOwner(500, procs, localTerminals([term("t1", 200, 300)]))).toBe("t1");
  expect(chainOwner(500, procs, localTerminals([term("box/t9", 200, 300)]))).toBe(null);
  expect(chainOwner(7, procs, new Map())).toBe(null);
});

test("byAgent: every process summed into its owner; the rest kept apart", () => {
  const procs = new Map([P(300, 200, 100000), P(400, 300, 50000), P(900, 1, 7000)]);
  const cpu = new Map([[300, 2], [400, 3], [900, 1]]);
  const { rows, rest } = byAgent(procs, cpu, localTerminals([term("t1", 200, 300)]));
  expect(rows).toEqual([{ address: "t1", cpu: 5, rss: 150000 }]);
  expect(rest).toEqual({ cpu: 1, rss: 7000 });
});

test("visibleAgents: by the tab's own measure, CPU ≥ 1% or Memory ≥ 100 MB, largest first (Review Focus 3)", () => {
  const rows = [{ address: "a", cpu: 0.2, rss: 40 * 1024 }, { address: "b", cpu: 3, rss: 10 }, { address: "c", cpu: 0, rss: 200 * 1024 }];
  expect(visibleAgents(rows, "cpu").map((r) => r.address)).toEqual(["b"]);
  expect(visibleAgents(rows, "rss").map((r) => r.address)).toEqual(["c"]);
});

test("topProcs: the n largest by CPU or memory", () => {
  const procs = new Map([P(1, 0, 10), P(2, 0, 30), P(3, 0, 20)]);
  expect(topProcs(procs, new Map([[1, 5], [3, 1]]), "cpu", 2).map((p) => p.pid)).toEqual([1, 3]);
  expect(topProcs(procs, new Map(), "rss", 2).map((p) => p.pid)).toEqual([2, 3]);
});

test("level: each threshold edge", () => {
  expect([level("cpu", 79), level("cpu", 80)]).toEqual(["ok", "warn"]);
  expect([level("mem", "normal"), level("mem", "warn"), level("mem", "critical")]).toEqual(["ok", "warn", "crit"]);
  expect([level("disk", 0.10), level("disk", 0.099), level("disk", 0.049)]).toEqual(["ok", "warn", "crit"]);
  expect([level("battery", 20), level("battery", 19), level("battery", 9)]).toEqual(["ok", "warn", "crit"]);
});

test("fmtBytes: MB below a GB, one decimal of GB above", () => {
  expect(fmtBytes(312 * 1024 * 1024)).toBe("312 MB");
  expect(fmtBytes(21.44 * 1024 ** 3)).toBe("21.4 GB");
});

test("segments: cpu, memory, disk, battery; dropped battery → disk → memory total as the bar narrows; '–' before two samples", () => {
  const state = { cpu: 34.4, mem: { used: 21 * 1024 ** 3, total: 36 * 1024 ** 3, pressure: "normal" }, disk: { size: 482797652, free: 14447236 },
    battery: { onBattery: true, percent: 64 } };
  const ids = (w) => segments(state, w).map((s) => s.id);
  expect(segments(state, 1200)).toEqual([
    { id: "cpu", text: "34%", level: "ok" }, { id: "mem", text: "21/36 GB", level: "ok" },
    { id: "disk", text: "14 GB free", level: "crit" }, { id: "battery", text: "64%", level: "ok" }]);
  expect(ids(1000)).toEqual(["cpu", "mem", "disk"]);
  expect(ids(800)).toEqual(["cpu", "mem"]);
  expect(segments(state, 700).find((s) => s.id === "mem").text).toBe("21 GB");
  expect(segments({ ...state, cpu: null }, 1200)[0].text).toBe("–");
  expect(segments({ ...state, battery: { onBattery: false, percent: 100 } }, 1200).map((s) => s.id)).toEqual(["cpu", "mem", "disk"]);
  expect(segments({ cpu: null, mem: null, disk: null, battery: null }, 1200)).toEqual([{ id: "cpu", text: "–", level: "ok" }]);
});

test("worktreePaths: every worktree's path from git worktree list --porcelain, bare entries skipped", () => {
  const text = "worktree /w/app\nHEAD 1a2b\nbranch refs/heads/main\n\nworktree /w/app/.claude/worktrees/x y\nHEAD 3c4d\nbranch refs/heads/feat\n\nworktree /w/bare.git\nbare\n";
  expect(worktreePaths(text)).toEqual(["/w/app", "/w/app/.claude/worktrees/x y"]);
  expect(worktreePaths("")).toEqual([]);
});

test("parseDu: KB from du -sk (path may hold spaces); null otherwise", () => {
  expect(parseDu("1052\t/Users/me/code/x y\n")).toBe(1052);
  expect(parseDu("")).toBe(null);
});

test("portsByPid: each pid's listening ports from lsof -F, ascending, IPv4/IPv6 once", () => {
  const m = portsByPid("p10\ncnode\nf3\nn*:5173\nf4\nn[::1]:5173\nf5\nn127.0.0.1:24678\np11\ncpg\nf6\nn127.0.0.1:5432\n");
  expect(m.get(10)).toEqual([5173, 24678]);
  expect(m.get(11)).toEqual([5432]);
  expect(portsByPid("").size).toBe(0);
});

test("splitAgents: rows by the tab's own measure (CPU ≥ 1%, Memory ≥ 100 MB); the rest's sums go to Everything else (review: Important 2)", () => {
  const rows = [{ address: "idle", cpu: 0.1, rss: 400 * 1024 }, { address: "busy", cpu: 30, rss: 50 * 1024 }];
  const cpu = splitAgents(rows, { cpu: 5, rss: 1000 }, "cpu");
  expect(cpu.shown.map((r) => r.address)).toEqual(["busy"]);
  expect(cpu.rest.cpu).toBeCloseTo(5.1, 5);           // the idle agent's CPU, so the rows add up to the headline
  const mem = splitAgents(rows, { cpu: 5, rss: 1000 }, "rss");
  expect(mem.shown.map((r) => r.address)).toEqual(["idle"]);
  expect(mem.rest.rss).toBe(1000 + 50 * 1024);
});

test("chipPort: a chip only for a port Ports has a row for, so it never closes the popup for nothing (review: Important 3)", () => {
  const rowKeys = new Set(["10:5173"]);
  expect(chipPort(10, [5173, 24678], rowKeys)).toBe(5173);
  expect(chipPort(10, [24678], rowKeys)).toBe(undefined);
  expect(chipPort(11, [5000], rowKeys)).toBe(undefined);
  expect(chipPort(10, undefined, rowKeys)).toBe(undefined);
});
