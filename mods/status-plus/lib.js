// System's numbers, as pure functions over recorded command output: memory, pressure, swap, disk, battery, and CPU
// from two `ps` samples. main.js runs the commands and draws; lib.test.js pins every parser and rule.

const MB = 1024 * 1024;
const PRESSURE = { 1: "normal", 2: "warn", 4: "critical" };

// ---- Parsers ----

// `vm_stat` -> page counts, at the page size its first line states (16384 on Apple silicon, not 4096).
export function parseVmStat(text) {
  const page = Number(/page size of (\d+) bytes/.exec(text ?? "")?.[1]);
  if (!page) return null;
  const pages = (label) => Number(new RegExp(`^${label}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0);
  return { page, active: pages("Pages active"), wired: pages("Pages wired down"), compressed: pages("Pages occupied by compressor") };
}

// What Activity Monitor calls used: app (active), wired and compressed memory.
export const memUsed = (vm) => (vm.active + vm.wired + vm.compressed) * vm.page;

// `sysctl -n hw.memsize hw.ncpu kern.memorystatus_vm_pressure_level` -> { total, cores, pressure }.
export function parseSysctl(text) {
  const [total, cores, level] = (text ?? "").trim().split(/\s+/).map(Number);
  if (!total || !cores) return null;
  return { total, cores, pressure: PRESSURE[level] ?? "normal" };
}

// `sysctl -n vm.swapusage` -> bytes used.
export function parseSwap(text) {
  const m = /used = ([\d.]+)([MG])/.exec(text ?? "");
  return m ? Math.round(Number(m[1]) * (m[2] === "G" ? 1024 * MB : MB)) : null;
}

// `df -k <path>` -> { size, free } in KB, from the last line (size, used, available are fields 2–4).
export function parseDf(text) {
  const last = (text ?? "").trim().split("\n").pop() ?? "";
  const f = last.trim().split(/\s+/);
  const size = Number(f[1]), free = Number(f[3]);
  return size > 0 && Number.isFinite(free) ? { size, free } : null;
}

// `pmset -g batt` -> { onBattery, percent }, or null without a battery.
export function parseBattery(text) {
  const pct = /(\d+)%/.exec(text ?? "");
  if (!pct) return null;
  return { onBattery: /'Battery Power'/.test(text), percent: Number(pct[1]) };
}

// ps's cumulative CPU time (m:ss.cc, h:mm:ss[.cc], d-hh:mm:ss) -> seconds; a copy of mods/port-card/lib.js.
export function parseCpuTime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec((s ?? "").trim());
  if (!m) return null;
  const [, d = 0, h = 0, min, sec] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(sec);
}

// `ps -axo pid=,ppid=,rss=,time=,comm=` -> Map pid -> { pid, ppid, rss (KB), cpu (s), comm }. comm is last: on macOS
// it's a full path that may hold spaces.
export function parseProcs(text) {
  const out = new Map();
  for (const line of (text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    const cpu = m && parseCpuTime(m[4]);
    if (!m || cpu == null) continue;
    const pid = Number(m[1]);
    out.set(pid, { pid, ppid: Number(m[2]), rss: Number(m[3]), cpu, comm: m[5].trim() });
  }
  return out;
}

// ---- CPU ----

// CPU between two samples ({ at: ms, procs }): each pid's CPU time grown over the wall time and the cores, as a share
// of the whole machine (0–100). Only pids in both samples whose time grew count: a new pid has no baseline, and a
// pid whose time went down is a reused pid. Null on the first poll or when no time passed.
export function cpuSample(prev, next, cores) {
  if (!prev || !next || next.at <= prev.at || !cores) return null;
  const capacity = ((next.at - prev.at) / 1000) * cores;
  const byPid = new Map();
  let total = 0;
  for (const [pid, p] of next.procs) {
    const before = prev.procs.get(pid);
    const grown = before ? p.cpu - before.cpu : 0;
    if (grown <= 0) continue;
    const pct = (grown / capacity) * 100;
    byPid.set(pid, pct);
    total += pct;
  }
  return { total: Math.min(100, total), byPid };
}
