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

// ---- Ownership ----

const DOCKER = /^(com\.docker\.|vpnkit|OrbStack)/; // Docker Desktop / OrbStack: they publish containers' ports
const TEMP_ROOTS = ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"];
const MAX_HOPS = 64;

export const basename = (path) => (path ?? "").split("/").filter(Boolean).pop() ?? "";
const inside = (path, root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

// Claude Code names a project's folders by its path with every non-alphanumeric character as "-".
export const slug = (path) => (path ?? "").replace(/[^A-Za-z0-9]/g, "-");

// A Claude Code scratchpad, <temp>/claude-<uid>/<slug>/…: the slug of the project it belongs to.
export function scratchSlug(cwd) {
  if (!cwd || !TEMP_ROOTS.some((r) => cwd.startsWith(r))) return null;
  return /\/claude-\d+\/([^/]+)/.exec(cwd)?.[1] ?? null;
}

// What owner() needs from Herdr's terminals(), for this computer's live terminals only (a remote terminal's pid is
// another machine's). roots: Map folder -> its git top-level, or null when it isn't in a repo.
//   byPid: shell pid and foreground pid -> address; fg: agents' foreground pids (their own ports are hidden);
//   areas: the folder each terminal claims for a server with no terminal above it.
export function ownerContext({ terminals, roots, home }) {
  const local = (terminals ?? []).filter((t) => t.state === "live" && t.machine == null);
  const byPid = new Map(), fg = new Set(), areas = [];
  const strip = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
  for (const t of local) {
    if (t.pid) byPid.set(t.pid, t.address);
    if (t.foreground?.pid) {
      byPid.set(t.foreground.pid, t.address);
      if (t.program?.agent || t.report) fg.add(t.foreground.pid);
    }
    const folder = t.foreground?.cwd ?? t.cwd;
    if (!folder) continue;
    const top = roots?.get(folder) ?? null;
    const root = strip(top ?? folder);
    if (root === strip(home ?? "") || root === "/") continue; // ~ or / would claim every orphan on the machine
    areas.push({ root, exact: !top, slug: slug(folder), address: t.address, seq: t.status_ms ?? 0 });
  }
  return { byPid, fg, areas };
}

const latest = (list) => list.reduce((a, b) => (b.seq > a.seq ? b : a));

// Who owns a process: "sure" (a terminal is on its parent chain), "docker", "probable" (its folder is inside a
// terminal's worktree, or it's that agent's Claude scratchpad), else "orphan".
export function owner(pid, procs, cwd, ctx) {
  const seen = new Set();
  for (let p = pid, hops = 0; p > 1 && hops < MAX_HOPS && !seen.has(p); hops++) {
    if (ctx.byPid.has(p)) return { kind: "sure", address: ctx.byPid.get(p) };
    seen.add(p);
    const proc = procs.get(p);
    if (!proc) break;
    p = proc.ppid;
  }
  if (DOCKER.test(basename(procs.get(pid)?.comm))) return { kind: "docker", address: null };
  if (cwd) {
    const hits = ctx.areas.filter((a) => (a.exact ? cwd === a.root : inside(cwd, a.root)));
    if (hits.length) {
      const deepest = Math.max(...hits.map((a) => a.root.length));
      return { kind: "probable", address: latest(hits.filter((a) => a.root.length === deepest)).address };
    }
    const s = scratchSlug(cwd);
    const mine = s ? ctx.areas.filter((a) => a.slug === s) : [];
    if (mine.length) return { kind: "probable", address: latest(mine).address };
  }
  return { kind: "orphan", address: null };
}

// ---- Servers (the rows) ----

const AGENT_BINS = ["claude", "codex", "omp", "pi", "opencode"];
// ponytail: a table of well-known non-web ports and programs, never a request to the port (a one-shot login
// callback would take a probe as its answer). Upgrade: probe on the person's own click.
const NOT_WEB_PORTS = [5432, 3306, 6379, 27017, 9229, 9230, 11211, 5672, 1883, 2181, 9092];
const NOT_WEB_NAMES = ["postgres", "mysqld", "redis-server", "mongod", "memcached"];
const ANY = ["*", "0.0.0.0", "[::]"];
const LOOPBACK = (h) => h === "[::1]" || h === "localhost" || h.startsWith("127.");

export function urlFor(hosts, port) {
  const has = (h) => hosts.includes(h);
  const host = hosts.some((h) => ANY.includes(h)) || (has("127.0.0.1") && has("[::1]")) ? "localhost"
    : has("127.0.0.1") ? "127.0.0.1" : has("[::1]") ? "[::1]" : hosts[0];
  return `http://${host}:${port}`;
}

export const isWeb = (port, comm) => !NOT_WEB_PORTS.includes(port) && !NOT_WEB_NAMES.includes(basename(comm));

export const holds = (listeners, pid, port) => listeners.some((l) => l.pid === pid && l.port === port);

export function ago(seconds) {
  const m = Math.floor(seconds / 60);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

// An ancestor of pid that also listens on port: then pid is a worker sharing its supervisor's socket.
function heldAbove(pid, port, procs, holders) {
  const seen = new Set([pid]);
  for (let p = procs.get(pid)?.ppid, hops = 0; p > 1 && hops < MAX_HOPS && !seen.has(p); hops++) {
    if (holders.has(`${p}:${port}`)) return true;
    seen.add(p);
    p = procs.get(p)?.ppid;
  }
  return false;
}

// ponytail: an orphan is shown when it runs from home or a temp folder and isn't an agent binary; that drops system
// services. A service started from ~ would show; a name list is the upgrade.
const worthShowing = (o, cwd, comm, home) =>
  o.kind !== "orphan" || (!!cwd && (inside(cwd, home) || TEMP_ROOTS.some((r) => cwd.startsWith(r))) && !AGENT_BINS.includes(basename(comm)));

// Every listening server worth a row: one per pid+port (hosts merged), workers folded into their supervisor, the
// agents' own ports and system services left out.
export function servers({ listeners, procs, cwds, ctx, home }) {
  const groups = new Map();
  for (const l of listeners) {
    const key = `${l.pid}:${l.port}`;
    const g = groups.get(key) ?? { pid: l.pid, port: l.port, command: l.command, hosts: [] };
    groups.set(key, { ...g, hosts: g.hosts.includes(l.host) ? g.hosts : [...g.hosts, l.host] });
  }
  const portsOf = (pid) => [...new Set(listeners.filter((l) => l.pid === pid).map((l) => l.port))].sort((a, b) => a - b);
  const out = [];
  for (const [key, g] of groups) {
    if (heldAbove(g.pid, g.port, procs, groups) || ctx.fg.has(g.pid)) continue;
    const cwd = cwds.get(g.pid) ?? null, comm = procs.get(g.pid)?.comm ?? g.command;
    const o = owner(g.pid, procs, cwd ?? undefined, ctx);
    if (!worthShowing(o, cwd, comm, home)) continue;
    out.push({ key, pid: g.pid, port: g.port, ports: portsOf(g.pid), command: basename(comm) || g.command, hosts: g.hosts,
      url: urlFor(g.hosts, g.port), web: isWeb(g.port, comm),
      network: g.hosts.some((h) => ANY.includes(h) || !LOOPBACK(h)), age: procs.get(g.pid)?.age ?? 0, cwd, owner: o });
  }
  return out;
}

export function sortServers(list) {
  const orphan = (s) => s.owner.kind === "orphan";
  return [...list].sort((a, b) => orphan(a) - orphan(b) || (orphan(a) ? b.age - a.age : a.port - b.port));
}

// ---- The block ----

export const ROW_H = 30, HEADER_H = 41, EMPTY_H = 32, MAX_ROWS = 5;

// The Ports block's height: a function of the row count only, so it can't chase Inbox's fitSpaces in a resize loop.
export const blockHeight = (rows, folded) => (folded ? 0 : rows ? HEADER_H + Math.min(rows, MAX_ROWS) * ROW_H : EMPTY_H);
