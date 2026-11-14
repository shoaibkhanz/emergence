import { test, expect } from "bun:test";
import { parseVmStat, memUsed, parseSysctl, parseSwap, parseDf, parseBattery, parseProcs, cpuSample } from "./lib.js";
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

test("cpuSample: a process new since the last poll, or whose time went down (pid reused), counts 0 (Review Focus 2)", () => {
  const s = cpuSample({ at: 0, procs: procs([1, 10], [3, 99]) }, { at: 5000, procs: procs([1, 10], [2, 500], [3, 1]) }, 10);
  expect(s.total).toBe(0);
  expect(s.byPid.get(2) ?? 0).toBe(0);
  expect(s.byPid.get(3) ?? 0).toBe(0);
});
