// herdr-mods: the Excalidraw library's folder on disk (ported from the retired Diagrams library). <appHome>/data/excalidraw
// holds the drawings agents and the library make, index.json (library.js: titles, repos, pins, dates), .previews/ (a
// small SVG per drawing, renamed whenever it changes so an image is never stale) and .trash/ (deleted drawings, kept
// library.js TRASH_DAYS). The panel and the library window both write the index, so every write is compare-and-swap.

import { exec, appHome, home, readTextFile, writeTextFile } from "herdr";
import { observe, declaredRepos, repoKey, expired } from "./library.js";
import { previewSvg } from "./preview.js";

export const dir = () => `${appHome()}/data/excalidraw`;
export const EXT = ".excalidraw";

// --- the index ---
export async function readIndex() {
  const raw = await readTextFile(`${dir()}/index.json`);
  let index = { v: 1, files: {} };
  try { if (raw) index = { v: 1, files: {}, ...JSON.parse(raw) }; } catch { /* a broken index is rebuilt from the files */ }
  return { raw, index };
}
export async function updateIndex(change) {
  for (let tries = 0; ; tries++) {
    const { raw, index } = await readIndex();
    const next = change(JSON.parse(JSON.stringify(index)));
    const text = JSON.stringify(next, null, 1) + "\n";
    if (text === raw) return next;
    try { await writeTextFile(`${dir()}/index.json`, text, raw ?? null); return next; }
    catch (e) { if (tries >= 3) throw e; } // someone else wrote it meanwhile: read again
  }
}
export const setEntry = (name, patch) => updateIndex((ix) => ({ ...ix, files: { ...ix.files, [name]: { ...(ix.files[name] ?? {}), ...patch } } }));

// --- repos: the git checkout a folder is in, keyed by remote (library.js repoKey) ---
const repos = new Map();
export function repoOf(folder) {
  if (!folder) return Promise.resolve(null);
  if (!repos.has(folder)) repos.set(folder, (async () => {
    const r = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir --show-toplevel --abbrev-ref HEAD 2>/dev/null && git remote get-url origin 2>/dev/null', "sh", folder]);
    const [common, top, branch, remote] = r.stdout.split("\n");
    if (!common) return null;
    return { key: repoKey(remote, common), path: top, remote: remote || null, branch: branch || null };
  })());
  return repos.get(folder);
}

// --- reading the folder into the index ---
// One `stat` listing gives each drawing's size and modified time: unchanged ones cost nothing; changed or new ones are
// read for their shape count and declared repos and get a fresh preview. One too big to read (Herdr reads up to 1 MiB)
// or not Excalidraw's JSON stays listed, marked broken. Gone files lose their entries; trash past its time is removed.
export async function scan(now = Date.now()) {
  const ls = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && for f in *.excalidraw; do [ -f "$f" ] && stat -f "%z %m %N" -- "$f"; done', "sh", dir()]);
  const files = ls.stdout.split("\n").map((l) => l.match(/^(\d+) (\d+) (.+)$/)).filter(Boolean).map(([, size, mtime, name]) => ({ name, sum: `${size}:${mtime}` }));
  const { index } = await readIndex();
  const seen = {};
  await Promise.all(files.map(async ({ name, sum }) => {
    const prev = index.files[name];
    if (prev && prev.sum === sum && prev.preview !== undefined) { seen[name] = prev; return; }
    const title = name.slice(0, -EXT.length);
    try {
      const text = await readTextFile(`${dir()}/${name}`);
      const doc = JSON.parse(text ?? "");
      if (!Array.isArray(doc?.elements)) throw new Error("not an Excalidraw drawing");
      const shapes = doc.elements.filter((e) => e && !e.isDeleted && !(e.type === "text" && e.containerId)).length;
      const declared = (await Promise.all(declaredRepos(doc.appState ?? {}, home()).map(repoOf))).filter(Boolean);
      const entry = observe(prev, { sum, title, nodes: shapes, repos: declared, tags: [], now });
      seen[name] = { ...entry, broken: undefined, preview: await preview(name, sum, doc.elements, prev?.preview) };
    } catch (e) {
      seen[name] = { ...(prev ?? observe(undefined, { sum, title, nodes: 0, now })), sum, preview: prev?.preview ?? null, broken: String(e?.message ?? e).slice(0, 80) };
    }
  }));
  const next = await updateIndex((ix) => {
    const out = {};
    for (const [n, e] of Object.entries(ix.files)) if (e.deleted != null && !expired(e, now)) out[n] = e; // the trash stays until its time
    for (const [n, e] of Object.entries(seen)) out[n] = { ...ix.files[n], ...e };
    return { ...ix, files: out };
  });
  const gone = Object.entries(index.files).filter(([, e]) => e.deleted != null && expired(e, now)).map(([n]) => n);
  if (gone.length) await exec("rm", ["-f", ...gone.map((n) => `${dir()}/.trash/${n}`)]);
  return next;
}

// The drawing's preview file, renamed with its fingerprint; the old one goes.
async function preview(name, sum, elements, old) {
  const file = `.previews/${name.slice(0, -EXT.length)}-${sum.replace(":", "-")}.svg`;
  await exec("mkdir", ["-p", `${dir()}/.previews`]);
  try { await writeTextFile(`${dir()}/${file}`, previewSvg(elements), null); } catch { /* already there */ }
  if (old && old !== file) await exec("rm", ["-f", `${dir()}/${old}`]);
  return file;
}

// --- moving files (the file's path never changes on a rename: open.json and agents hold it) ---
export async function trash(name) {
  await exec("sh", ["-c", 'mkdir -p "$1/.trash" && mv "$1/$2" "$1/.trash/$2"', "sh", dir(), name]);
  await setEntry(name, { deleted: Date.now() });
}
export async function duplicate(name, copy, entry) {
  const raw = await readTextFile(`${dir()}/${name}`);
  await writeTextFile(`${dir()}/${copy}`, raw ?? "", null);
  await setEntry(copy, { ...entry, title: `${entry.title} copy`, named: true, by: "user", created: Date.now(), updated: Date.now(), pinned: false, preview: undefined, sum: null });
}
export async function create(name, title, repo) {
  await exec("mkdir", ["-p", dir()]);
  const doc = { type: "excalidraw", version: 2, source: "herdr-excalidraw", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} };
  await writeTextFile(`${dir()}/${name}`, JSON.stringify(doc, null, 1) + "\n", null);
  await setEntry(name, { title, named: true, by: "user", repos: repo ? [repo] : [], created: Date.now(), updated: Date.now(), pinned: false, tags: [] });
}
