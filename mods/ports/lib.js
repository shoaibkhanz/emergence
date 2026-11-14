// Ports' decisions, as pure functions over `lsof`/`ps` text and Herdr's terminals(): which servers are listening,
// which agent owns each, and how a row reads. main.js does the IO and the drawing; lib.test.js pins every rule.

// ---- Parsers ----

// `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` -> [{ pid, command, host, port }], one per distinct pid+host+port.
// -F prints one field a line: p<pid> starts a process, c<command>, f<fd>, n<name>. Only "host:port" names count.
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

// `lsof -a -p <pids> -d cwd -Fpn` -> Map pid -> folder.
export function parseCwds(text) {
  const out = new Map();
  let pid = 0;
  for (const line of (text ?? "").split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid) out.set(pid, line.slice(1));
  }
  return out;
}

// ps's elapsed time, [[dd-]hh:]mm:ss -> seconds; 0 when it isn't one.
export function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec((s ?? "").trim());
  if (!m) return 0;
  const [, d = 0, h = 0, min, sec] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(sec);
}

// `ps -axo pid=,ppid=,etime=,comm=` -> Map pid -> { pid, ppid, age, comm }. comm is last: on macOS it's a full path
// that may hold spaces.
export function parsePs(text) {
  const out = new Map();
  for (const line of (text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    out.set(pid, { pid, ppid: Number(m[2]), age: parseEtime(m[3]), comm: m[4].trim() });
  }
  return out;
}
