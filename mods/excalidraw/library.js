// The Excalidraw library's pure parts (ported from the retired Diagrams library). Drawings are *.excalidraw files in one
// folder (<appHome>/data/excalidraw); the mod keeps index.json beside them, the durable record of what it has seen:
// title, repos, tags, pinned, who made it, and when it was made and changed. A drawing may declare its repos itself
// (appState.herdr_repos = "~/code/a,~/code/b"); those are merged in on every change, never removed. Nothing expires but
// deleted drawings: they sit in .trash/ for TRASH_DAYS.

export const TRASH_DAYS = 30;
const DAY = 86400000;

// One key per repository, whichever remote spelling or worktree it's seen from: the remote without scheme, user and
// .git ("github.com/acme/shop"), else the git common dir.
export function repoKey(remote, commonDir) {
  const r = String(remote ?? "").trim();
  if (r) return r.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "").replace(/^([^/:]+):(?!\d)/, "$1/").replace(/\.git\/?$/, "").replace(/\/+$/, "");
  return commonDir ?? null;
}
export const repoName = (key) => String(key ?? "").replace(/\/\.git\/?$/, "").replace(/\/+$/, "").split("/").pop() || "repo";

export const declaredRepos = (graph, home) => String(graph?.herdr_repos ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  .map((p) => (p.startsWith("~/") ? home + p.slice(1) : p));

// What the mod saw of a file now -> its new index entry. `sum` is the file's fingerprint. `named` marks a title the person set in
// the library, which the file's own label no longer overrides.
export function observe(prev, { sum, title, nodes, repos = [], tags = [], now }) {
  const changed = !prev || prev.sum !== sum;
  const merged = [...(prev?.repos ?? [])];
  for (const r of repos) if (!merged.some((m) => m.key === r.key)) merged.push(r);
  return {
    pinned: false, by: "agent", created: now, tags: [], ...prev,
    title: prev?.named ? prev.title : title,
    nodes, sum, repos: merged,
    tags: [...new Set([...(prev?.tags ?? []), ...tags])],
    updated: changed ? now : prev.updated,
  };
}

const newest = (a, b) => (b.pinned - a.pinned) || (b.updated - a.updated);
// The library's sections. tab "repo": this repo first, then the other repos by their newest diagram, Unfiled last;
// each diagram once, under this repo if it touches it, else under its first repo. "pinned": pinned ones only, same
// grouping. "all": one section, newest first.
export function sections(entries, current, tab) {
  const list = tab === "pinned" ? entries.filter((e) => e.pinned) : entries;
  if (tab === "all") return [{ key: "all", rows: [...list].sort(newest) }];
  const home = (e) => (e.repos.some((r) => r.key === current) ? current : e.repos[0]?.key ?? null);
  const by = new Map();
  for (const e of list) { const k = home(e); by.set(k, [...(by.get(k) ?? []), e]); }
  const latest = (rows) => Math.max(...rows.map((r) => r.updated));
  return [...by].map(([key, rows]) => ({ key, rows: rows.sort(newest) }))
    .sort((a, b) => (a.key === null) - (b.key === null) || (b.key === current) - (a.key === current) || latest(b.rows) - latest(a.rows));
}

// Typing: one flat list, title matches first, then tags, then repos.
export function search(entries, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (e) => (e.title.toLowerCase().includes(q) ? 0 : e.tags.some((t) => t.toLowerCase().includes(q)) ? 1 : e.repos.some((r) => String(r.key).toLowerCase().includes(q)) ? 2 : -1);
  return entries.map((e) => [e, rank(e)]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1] || b[0].updated - a[0].updated).map(([e]) => e);
}

// A new drawing's file: <repo>-<topic>.excalidraw, numbered past any taken.
export function freeName(repo, topic, taken) {
  const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = [slug(repo), slug(topic)].filter(Boolean).join("-") || "drawing";
  let name = `${base}.excalidraw`;
  for (let i = 2; taken.includes(name); i++) name = `${base}-${i}.excalidraw`;
  return name;
}

export const expired = (e, now) => e.deleted != null && now - e.deleted > TRASH_DAYS * DAY;

export function ago(t, now) {
  const s = (now - t) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2 * 86400) return "Yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 30 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}

// The repo picker's choices: every repo a diagram names, plus the one the library was opened from (first).
export function knownRepos(entries, here) {
  const by = new Map(entries.flatMap((e) => e.repos).map((r) => [r.key, r]));
  if (here) by.delete(here.key);
  return [...(here ? [here] : []), ...[...by.values()].sort((a, b) => repoName(a.key).localeCompare(repoName(b.key)))];
}
export const toggleRepo = (repos, repo) => (repos.some((r) => r.key === repo.key) ? repos.filter((r) => r.key !== repo.key) : [...repos, repo]);

// The Trash tab: deleted drawings, the latest first, each with the whole days left before it's removed for good.
export const trashRows = (entries, now) => entries.filter((e) => e.deleted != null).sort((a, b) => b.deleted - a.deleted)
  .map((e) => ({ ...e, daysLeft: Math.max(0, Math.ceil(TRASH_DAYS - (now - e.deleted) / DAY)) }));
