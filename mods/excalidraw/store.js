// herdr-mods: the Excalidraw library's folder on disk (ported from the retired Diagrams library). <appHome>/data/excalidraw
// holds the drawings agents and the library make, index.json (library.js: titles, repos, pins, dates), .previews/ (a
// small SVG per drawing, renamed whenever it changes so an image is never stale) and .trash/ (deleted drawings, kept
// library.js TRASH_DAYS). The panel and the library window both write the index, so every write is compare-and-swap.

import { exec, appHome, home, readTextFile, writeTextFile } from "herdr";
import { observe, declaredRepos, repoKey, expired, freeName } from "./library.js";
import { previewSvg } from "./preview.js";
import * as fs from "fs/promises";

// herdr-mods: a drawing's text, up to 8 MB (exec's output is capped at 8 MiB) where readTextFile stops at 1 MiB, so a
// drawing with pasted images (stored in the file) still opens. null when the file isn't there; past 8 MB it throws
// saying so, never an empty read that looks like a missing or empty drawing.
const DRAWING_MAX = 8_000_000;
export async function readDrawingText(path) {
  const r = await exec("sh", ["-c", 'test -e "$1" || exit 3; n=$(wc -c < "$1") || exit 5; [ "$n" -le "$2" ] || { echo "$n" >&2; exit 4; }; cat "$1"', "sh", path, String(DRAWING_MAX)]);
  if (r.code === 3) return null;
  if (r.code === 4) throw new Error(`it's ${(parseInt(r.stderr, 10) / 1e6).toFixed(1)} MB, and drawings up to 8 MB open`); // 5: wc couldn't read it: its error below
  if (r.code !== 0) throw new Error((r.stderr || "can't read it").trim());
  return r.stdout;
}

// herdr-mods: writes text of any size: Herdr's writeTextFile refuses past 1 MiB ("Text file exceeds 1 MiB", reading the
// file for its `expected` check too). Small text goes through it as before. Bigger text under the app home (where a
// mod may write) gets the same check here, the file must still be what was last read (null: not there), then it's
// written beside and moved over, so a half-written drawing never replaces a whole one. Elsewhere: writeTextFile's limit.
const SMALL = 900_000; // characters: drawings are ASCII JSON (pasted images are base64), so well under 1 MiB in bytes
export async function writeText(path, text, expected) {
  if (text.length < SMALL && (expected ?? "").length < SMALL) return writeTextFile(path, text, expected);
  if (!path.startsWith(`${appHome()}/`)) throw new Error("Text file exceeds 1 MiB, and only files in Herdr's own folder save past that");
  const now = await readDrawingText(path);
  if ((expected == null && now != null) || (expected != null && now !== expected)) throw new Error("The file changed outside Herdr. Reload before saving.");
  const tmp = `${path}.${Date.now()}.saving`;
  await fs.writeFile(tmp, text);
  const r = await exec("mv", ["-f", tmp, path]);
  if (r.code !== 0) { await exec("rm", ["-f", tmp]); throw new Error((r.stderr || "couldn't save it").trim()); }
}

export const dir = () => `${appHome()}/data/excalidraw`;
export const EXT = ".excalidraw";

// --- the index ---
export async function readIndex() {
  const raw = await readTextFile(`${dir()}/index.json`);
  let index = { v: 1, files: {} };
  try { if (raw) index = { v: 1, files: {}, ...JSON.parse(raw) }; } catch { /* a broken index is rebuilt from the files */ }
  return { raw, index };
}
async function updateIndex(change) {
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
      const text = await readDrawingText(`${dir()}/${name}`);
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
    for (const [n, e] of Object.entries(seen)) out[n] = { ...ix.files[n], ...e, deleted: null }; // a drawing in the folder isn't in the trash
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
// Back from the trash, under its name, or a free one if a drawing has taken it since. Returns the name it got.
export async function restore(name) {
  const taken = (await exec("ls", ["-1", dir()])).stdout.split("\n");
  const back = taken.includes(name) ? freeName(null, name.slice(0, -EXT.length), taken) : name;
  const r = await exec("sh", ["-c", 'mv "$1/.trash/$2" "$1/$3"', "sh", dir(), name, back]);
  if (r.code) throw new Error(r.stderr.trim() || "couldn't restore it");
  await updateIndex((ix) => {
    const { [name]: was, ...files } = ix.files;
    return { ...ix, files: { ...files, [back]: { ...was, deleted: null, updated: Date.now() } } };
  });
  return back;
}
// Out of the trash for good: the file, its preview and its entry.
export async function deleteForever(name) {
  const { index } = await readIndex(), preview = index.files[name]?.preview;
  await exec("rm", ["-f", `${dir()}/.trash/${name}`, ...(preview ? [`${dir()}/${preview}`] : [])]);
  await updateIndex((ix) => { const { [name]: _gone, ...files } = ix.files; return { ...ix, files }; });
}
export async function duplicate(name, copy, entry) {
  const raw = await readDrawingText(`${dir()}/${name}`);
  await writeText(`${dir()}/${copy}`, raw ?? "", null);
  await setEntry(copy, { ...entry, title: `${entry.title} copy`, named: true, by: "user", created: Date.now(), updated: Date.now(), pinned: false, preview: undefined, sum: null });
}
export async function create(name, title, repo) {
  await exec("mkdir", ["-p", dir()]);
  const doc = { type: "excalidraw", version: 2, source: "herdr-excalidraw", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} };
  await writeTextFile(`${dir()}/${name}`, JSON.stringify(doc, null, 1) + "\n", null);
  await setEntry(name, { title, named: true, by: "user", repos: repo ? [repo] : [], created: Date.now(), updated: Date.now(), pinned: false, tags: [] });
}
