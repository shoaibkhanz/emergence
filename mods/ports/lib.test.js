import { test, expect } from "bun:test";
import { parseLsof, parseCwds, parsePs, parseEtime } from "./lib.js";
import { LSOF, CWDS, PS } from "./fixtures.js";

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
