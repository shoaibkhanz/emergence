// The port card's arithmetic: its one process's live numbers from `ps`, and the Stop recheck. parseLsof, holds and
// parseEtime are copies of mods/ports/lib.js (mods don't import across folders), kept identical.

const KB_PER_MB = 1024, KB_PER_GB = 1024 * 1024;

// ps's cumulative CPU time: m:ss.cc, h:mm:ss[.cc] or d-hh:mm:ss -> seconds; null when it isn't one.
export function parseCpuTime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec((s ?? "").trim());
  if (!m) return null;
  const [, d = 0, h = 0, min, sec] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(sec);
}

// CPU time grown between two samples ({ at: ms, cpu: s }) over the wall time between them; one core = 100.
export function cpuPercent(prev, next) {
  if (!prev || !next || next.at <= prev.at) return null;
  return Math.round(((next.cpu - prev.cpu) / ((next.at - prev.at) / 1000)) * 100);
}

export const formatMem = (kb) => (kb >= KB_PER_GB ? `${(kb / KB_PER_GB).toFixed(1)} GB` : `${Math.round(kb / KB_PER_MB)} MB`);

// From mods/ports/lib.js.
export function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec((s ?? "").trim());
  if (!m) return 0;
  const [, d = 0, h = 0, min, sec] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(sec);
}

// `ps -p <pid> -o time=,etime=,rss=` -> { cpu: s, age: s, rss: KB }, or null when the process is gone.
export function parseStat(text) {
  const m = /^\s*(\S+)\s+(\S+)\s+(\d+)\s*$/.exec((text ?? "").trim());
  const cpu = m && parseCpuTime(m[1]);
  return m && cpu != null ? { cpu, age: parseEtime(m[2]), rss: Number(m[3]) } : null;
}

// From mods/ports/lib.js.
export function parseLsof(text) {
  const out = [], seen = new Set();
  let pid = 0, command = "";
  for (const line of (text ?? "").split("\n")) {
    const tag = line[0], v = line.slice(1);
    if (tag === "p") { pid = Number(v); command = ""; }
    else if (tag === "c") command = v;
    else if (tag === "n" && pid) {
      const m = /^(.+):(\d+)$/.exec(v);
      if (!m) continue;
      const key = `${pid}|${m[1]}|${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pid, command, host: m[1], port: Number(m[2]) });
    }
  }
  return out;
}

// From mods/ports/lib.js.
export const holds = (listeners, pid, port) => listeners.some((l) => l.pid === pid && l.port === port);

// `ps -o args=` with the program's absolute path replaced by its name (`command`, ps's comm basename). The path may
// hold spaces, so it's found by "/<command>" followed by a space or the end, not by splitting.
export function shortArgs(args, command) {
  const a = (args ?? "").trim();
  if (!a.startsWith("/") || !command) return a;
  const m = new RegExp(`/${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`).exec(a);
  return m ? `${command}${a.slice(m.index + m[0].length)}` : a;
}
