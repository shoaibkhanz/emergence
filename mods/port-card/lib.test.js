import { test, expect } from "bun:test";
import { parseCpuTime, cpuPercent, formatMem, parseStat, parseLsof, holds, shortArgs } from "./lib.js";

test("parseCpuTime: ps time forms (m:ss.cc, h:mm:ss, d-hh:mm:ss) to seconds", () => {
  expect(parseCpuTime("8:37.43")).toBeCloseTo(8 * 60 + 37.43, 5);
  expect(parseCpuTime("77:54.28")).toBeCloseTo(77 * 60 + 54.28, 5);
  expect(parseCpuTime("1:02:03")).toBe(3723);
  expect(parseCpuTime("2-01:00:00")).toBe(2 * 86400 + 3600);
  expect(parseCpuTime("nope")).toBe(null);
});

test("cpuPercent: CPU time grown over wall time, one core = 100%; null until two samples", () => {
  expect(cpuPercent(null, { at: 5000, cpu: 3 })).toBe(null);
  expect(cpuPercent({ at: 0, cpu: 1 }, { at: 5000, cpu: 1.5 })).toBe(10);
  expect(cpuPercent({ at: 0, cpu: 1 }, { at: 5000, cpu: 11 })).toBe(200); // two cores busy
  expect(cpuPercent({ at: 0, cpu: 2 }, { at: 0, cpu: 2 })).toBe(null); // no time passed
});

test("formatMem: KB from ps rss to MB or GB", () => {
  expect(formatMem(18848)).toBe("18 MB");
  expect(formatMem(213792)).toBe("209 MB");
  expect(formatMem(3 * 1024 * 1024 + 300 * 1024)).toBe("3.3 GB");
});

test("parseStat: `ps -o time=,etime=,rss=` line; null when the process is gone", () => {
  expect(parseStat("  8:37.43    12:52:51 213792\n")).toEqual({ cpu: 8 * 60 + 37.43, age: 12 * 3600 + 52 * 60 + 51, rss: 213792 });
  expect(parseStat("")).toBe(null);
});

test("holds (copied from ports): only while that pid holds that port", () => {
  const l = parseLsof("p22073\ncPython\nf3\nn127.0.0.1:8765\n");
  expect(holds(l, 22073, 8765)).toBe(true);
  expect(holds(l, 22073, 8766)).toBe(false);
  expect(holds(parseLsof(""), 22073, 8765)).toBe(false);
});

test("shortArgs: the program's path becomes its name; arguments kept; paths with spaces handled", () => {
  expect(shortArgs("/opt/homebrew/Cellar/python@3.15/3.15.2/Frameworks/Python.framework/Versions/3.15/Resources/Python.app/Contents/MacOS/Python -m http.server 8765 --bind 127.0.0.1", "Python"))
    .toBe("Python -m http.server 8765 --bind 127.0.0.1");
  expect(shortArgs("/Users/me/Library/Application Support/x/bin/node server.js", "node")).toBe("node server.js");
  expect(shortArgs("npm run dev", "node")).toBe("npm run dev"); // not a path: as is
  expect(shortArgs("/usr/bin/vite", "vite")).toBe("vite");
  expect(shortArgs("", "node")).toBe("");
});
