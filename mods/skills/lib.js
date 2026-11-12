// Host-free logic for the skills mod: front matter, merging sources, ranking, file grouping.

const fold = (lines) => lines.reduce((s, l) => (!l ? s + "\n" : s && !s.endsWith("\n") ? `${s} ${l}` : s + l), "");

function scalar(first, more) {
  const block = /^([|>])[+-]?\d*[+-]?\s*(#.*)?$/.exec(first);
  if (block) {
    while (more.length && !more[more.length - 1].trim()) more.pop();
    const indent = Math.min(...more.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
    const lines = more.map((l) => l.slice(indent).trimEnd());
    return (block[1] === "|" ? lines.join("\n") : fold(lines.map((l) => l.trim()))).trimEnd();
  }
  const text = fold([first, ...more].map((l) => l.trim()));
  const q = text[0];
  if (q === '"') {
    let out = "";
    for (let i = 1; i < text.length; i++) {
      const c = text[i];
      if (c === '"') return out;
      if (c !== "\\") { out += c; continue; }
      const n = text[++i];
      if (n === "u") { out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)); i += 4; }
      else out += { n: "\n", t: "\t", r: "", 0: "\0" }[n] ?? n ?? "";
    }
    return out;
  }
  if (q === "'") {
    let out = "";
    for (let i = 1; i < text.length; i++) {
      if (text[i] !== "'") out += text[i];
      else if (text[i + 1] === "'") { out += "'"; i++; }
      else return out;
    }
    return out;
  }
  return text.replace(/(^|\s)#.*$/, "").trim();
}

/** `---` YAML front matter → { meta: {key: string}, body }. Only flat `key: value` scalars matter here;
 *  nested maps are kept as their folded text. Missing or unterminated front matter → { meta: {}, body: text }. */
export function parseFrontMatter(text) {
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const lines = (m[1] ?? "").split("\n"), meta = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+)[ \t]*:(?:[ \t]+(.*))?$/.exec(lines[i]);
    if (!kv) continue;
    const more = [];
    while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]) || !lines[i + 1].trim())) more.push(lines[++i]);
    meta[kv[1]] = scalar(kv[2] ?? "", more);
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Scan rows {source, dir, real} → one skill per real folder with every source carrying it (in `order`).
 *  A SKILL.md nested inside another skill (a template, say) isn't a skill of its own. */
export function mergeSkills(rows, order) {
  const dirs = new Set(rows.map((r) => r.dir)), byReal = new Map();
  const nested = (dir) => { for (let p = dir; (p = p.slice(0, p.lastIndexOf("/"))); ) if (dirs.has(p)) return true; return false; };
  for (const r of rows) {
    if (!r.real || nested(r.dir)) continue;
    if (!byReal.has(r.real)) byReal.set(r.real, { real: r.real, dir: r.dir, sources: [] });
    const s = byReal.get(r.real);
    if (!s.sources.includes(r.source)) s.sources.push(r.source);
  }
  const out = [...byReal.values()];
  for (const s of out) s.sources.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return out;
}

/** installed_plugins.json `plugins` → one {id, name, marketplace, root, version} per plugin whose folder
 *  exists (`exists(path)`); a user install wins over a project one. */
export function pickPlugins(installed, exists) {
  const out = [];
  for (const [id, entries] of Object.entries(installed ?? {})) {
    const e = [].concat(entries).sort((a, b) => (b?.scope === "user") - (a?.scope === "user")).find((x) => x?.installPath && exists(x.installPath));
    const at = id.lastIndexOf("@");
    if (e) out.push({ id, name: at > 0 ? id.slice(0, at) : id, marketplace: at > 0 ? id.slice(at + 1) : "", root: e.installPath, version: e.version ?? "" });
  }
  return out;
}

const subsequence = (w, s) => { let i = 0; for (const c of s) if (c === w[i]) i++; return i === w.length; };
const byName = (a, b) => a.name.localeCompare(b.name);

/** Every query word must hit the name or description. Name hits outrank description hits;
 *  a loose in-order letter match on the name ("brst" → brainstorming) ranks last. */
export function rankSkills(skills, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...skills].sort(byName);
  const scored = [];
  for (const s of skills) {
    const name = s.name.toLowerCase(), desc = (s.description ?? "").toLowerCase();
    let score = name === words.join(" ") || name === words.join("-") ? 1000 : 0;
    for (const w of words) {
      const i = name.indexOf(w);
      if (i === 0) score += 100;
      else if (i > 0) score += /[-_ ]/.test(name[i - 1]) ? 60 : 40;
      else if (desc.includes(w)) score += 10;
      else if (w.length > 2 && subsequence(w, name)) score += 5;
      else { score = -1; break; }
    }
    if (score >= 0) scored.push([score, s]);
  }
  return scored.sort((a, b) => b[0] - a[0] || byName(a[1], b[1])).map((x) => x[1]);
}

const ASSET = /\.(png|jpe?g|gif|webp|ico|icns|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|tar|jar|ttf|otf|woff2?|eot|mp[34]|mov|wav|ogg|webm|db|sqlite|bin|exe|dylib|so|o|a|pyc|class|xlsx?|docx?|pptx?|key|numbers|pages)$/i;
/** "md" renders as markdown, "code" in a read-only editor, "asset" is only listed. */
export const fileKind = (path) => (/\.(md|mdx|markdown)$/i.test(path) ? "md" : ASSET.test(path) ? "asset" : "code");

/** SKILL.md, references/ docs, other docs, scripts/, other code, assets; by path within each. */
export function sortFiles(files) {
  const group = ({ path }) => {
    if (path === "SKILL.md") return 0;
    const k = fileKind(path);
    return k === "md" ? (path.startsWith("references/") ? 1 : 2) : k === "code" ? (path.startsWith("scripts/") ? 3 : 4) : 5;
  };
  return [...files].sort((a, b) => group(a) - group(b) || a.path.localeCompare(b.path));
}

/** `wc -c` lines ("  123 /abs/dir/a/b") under `dir` → [{path: "a/b", size}], without the total line. */
export function parseListing(stdout, dir) {
  const out = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+) (.+)$/.exec(line);
    if (m && m[2].startsWith(`${dir}/`)) out.push({ path: m[2].slice(dir.length + 1), size: +m[1] });
  }
  return sortFiles(out);
}

/** A link clicked in `current`'s markdown → the skill file it names, or null (external / unknown). */
export function resolveLink(url, paths, current) {
  let p = url.replace(/[#?].*$/, "");
  if (/^https?:/i.test(p) || /^mailto:/i.test(p)) return null;
  p = decodeURIComponent(p.replace(/^file:\/\//i, ""));
  const parts = current.split("/").slice(0, -1);
  for (const seg of p.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  const rel = parts.join("/");
  if (paths.includes(rel)) return rel;
  return paths.filter((f) => p === f || p.endsWith(`/${f}`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

export const formatSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
