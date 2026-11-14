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
