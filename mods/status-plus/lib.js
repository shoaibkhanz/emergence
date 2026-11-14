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

// ---- Who uses it ----

const MAX_HOPS = 64;
const GB = 1024 * MB;
const VISIBLE = { cpu: 1, rssKB: 100 * 1024 }; // a By-agent row: at least 1% CPU or 100 MB

// Shell and foreground pids of this computer's live terminals -> the top-level agent's address (a sub-agent counts for
// the agent that started it). Remote terminals carry a machine and a "<machine>/" address; their pids are another
// machine's.
export function localTerminals(terminals) {
  const local = (terminals ?? []).filter((t) => t.state === "live" && t.machine == null && !String(t.address ?? "").includes("/"));
  const out = new Map();
  for (const t of local) {
    const top = t.parent ?? t.address;
    if (t.pid) out.set(t.pid, top);
    if (t.foreground?.pid) out.set(t.foreground.pid, top);
  }
  return out;
}

// The first terminal on a process's parent chain, or null.
export function chainOwner(pid, procs, byPid) {
  const seen = new Set();
  for (let p = pid, hops = 0; p > 1 && hops < MAX_HOPS && !seen.has(p); hops++) {
    if (byPid.has(p)) return byPid.get(p);
    seen.add(p);
    p = procs.get(p)?.ppid;
  }
  return null;
}

// Every process's CPU (cpu: Map pid -> %) and memory (rss KB) summed into its owning agent; the rest apart.
export function byAgent(procs, cpu, byPid) {
  const sums = new Map(), rest = { cpu: 0, rss: 0 };
  for (const [pid, p] of procs) {
    const address = chainOwner(pid, procs, byPid), c = cpu?.get(pid) ?? 0;
    if (!address) { rest.cpu += c; rest.rss += p.rss; continue; }
    const s = sums.get(address) ?? { address, cpu: 0, rss: 0 };
    sums.set(address, { ...s, cpu: s.cpu + c, rss: s.rss + p.rss });
  }
  return { rows: [...sums.values()], rest };
}

// The rows worth showing, largest first by the tab's measure ("cpu" or "rss").
export const visibleAgents = (rows, key) =>
  rows.filter((r) => r.cpu >= VISIBLE.cpu || r.rss >= VISIBLE.rssKB).sort((a, b) => b[key] - a[key]);

// The n processes using the most CPU (cpu: Map pid -> %) or memory.
export function topProcs(procs, cpu, key, n = 8) {
  const value = (p) => (key === "cpu" ? cpu?.get(p.pid) ?? 0 : p.rss);
  return [...procs.values()].sort((a, b) => value(b) - value(a)).slice(0, n);
}

// ---- The bar ----

const LEVELS = {
  cpu: (v) => (v >= 80 ? "warn" : "ok"),
  mem: (v) => ({ warn: "warn", critical: "crit" })[v] ?? "ok", // memory pressure, never "used"
  disk: (v) => (v < 0.05 ? "crit" : v < 0.1 ? "warn" : "ok"), // fraction free
  battery: (v) => (v < 10 ? "crit" : v < 20 ? "warn" : "ok"),
};
export const level = (kind, value) => LEVELS[kind](value);

export const fmtBytes = (b) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
const wholeGB = (b) => Math.round(b / GB);

// The status bar's widths (px) below which battery, then disk, then the memory total drop out.
export const WIDE = 1100, MEDIUM = 900, NARROW = 760;

// What the bar shows: cpu ("–" until two samples), memory used/total, disk free, battery (only on battery). A part
// whose command failed (null) isn't shown.
export function segments({ cpu, mem, disk, battery }, width) {
  const out = [{ id: "cpu", text: cpu == null ? "–" : `${Math.round(cpu)}%`, level: cpu == null ? "ok" : level("cpu", cpu) }];
  if (mem) out.push({ id: "mem", text: width >= NARROW ? `${wholeGB(mem.used)}/${wholeGB(mem.total)} GB` : `${wholeGB(mem.used)} GB`,
    level: level("mem", mem.pressure) });
  if (disk && width >= MEDIUM) out.push({ id: "disk", text: `${wholeGB(disk.free * 1024)} GB free`, level: level("disk", disk.free / disk.size) });
  if (battery?.onBattery && width >= WIDE) out.push({ id: "battery", text: `${battery.percent}%`, level: level("battery", battery.percent) });
  return out;
}

// ---- The popup's Disk and ports ----

// `git worktree list --porcelain` -> every worktree's path (a bare repository has none to measure).
export function worktreePaths(text) {
  return (text ?? "").split(/\n\n+/).map((block) => ({ path: /^worktree (.+)$/m.exec(block)?.[1], bare: /^bare$/m.test(block) }))
    .filter((w) => w.path && !w.bare).map((w) => w.path);
}

// `du -sk <path>` -> KB, or null.
export function parseDu(text) {
  const m = /^(\d+)\s/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

// `lsof -nP -iTCP -sTCP:LISTEN -Fpn` -> Map pid -> its listening ports, ascending, each once.
export function portsByPid(text) {
  const out = new Map();
  let pid = 0;
  for (const line of (text ?? "").split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    const port = line[0] === "n" && pid ? Number(/:(\d+)$/.exec(line)?.[1]) : 0;
    if (port) out.set(pid, [...new Set([...(out.get(pid) ?? []), port])].sort((a, b) => a - b));
  }
  return out;
}
