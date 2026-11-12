// Library: every agent skill on this machine (and in the focused repo), plus installed Claude Code plugins
// and the skills they ship; searchable, readable. Palette popup (mod.open:skills) and side panel.
// Window role (props.role === "window"): SKILL.md, references and scripts of one skill (or a plugin's files).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, Editor, EditorState, ScrollHandle } from "gpui-base";
import { exec, home, focused, spaces, theme, settings, props, layout, run, openOverlay, closeOverlay, readTextFile, nextCommand } from "herdr";
import { parseFrontMatter, mergeSkills, pickPlugins, rankSkills, fileKind, parseListing, resolveLink, formatSize } from "./lib.js";

const ORDER = ["Agents", "Claude", "OpenCode", "Codex", "Project"];
const MAX = 1048576; // readTextFile's limit
const MONO = "Geist Mono";
const icon = (name) => svg(`mods/skills/${name}.svg`);
const tilde = (p) => (p.startsWith(home()) ? `~${p.slice(home().length)}` : p);
const stop = (_e, cx) => cx.stop_propagation();
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", yml: "yaml", jsonc: "json", svelte: "html", vue: "html", htm: "html" };

// One line per SKILL.md found under each source: label, folder as found, real folder.
const SCAN = 'while [ $# -gt 1 ]; do l=$1; s=$2; shift 2; find -L "$s" -maxdepth 4 -name SKILL.md -type f 2>/dev/null | while IFS= read -r f; do d=${f%/SKILL.md}; printf "%s\\t%s\\t%s\\n" "$l" "$d" "$(cd -P "$d" 2>/dev/null && pwd -P)"; done; done';
// ponytail: first 500 files of a skill, hidden files and node_modules skipped.
const LIST = 'cd "$1" && find -L . -type f ! -path "*/.*" ! -path "*/node_modules/*" 2>/dev/null | head -500 | tr "\\n" "\\0" | xargs -0 wc -c';
const EXISTS = 'for d in "$@"; do [ -d "$d" ] && printf "%s\\n" "$d"; done';

// Shared by every copy and kept after the palette closes, so reopening is instant (⌘R rescans).
let cache = null;
const listings = new Map();

const rows = (stdout) => stdout.split("\n").filter(Boolean).map((l) => { const [source, dir, real] = l.split("\t"); return { source, dir, real }; });

// SKILL.md front matter names and describes each skill; its body is the preview.
async function describe(skills) {
  await Promise.all(skills.map(async (s) => {
    let text = null;
    try { text = await readTextFile(`${s.real}/SKILL.md`); } catch {}
    const { meta, body } = parseFrontMatter(text ?? "");
    s.name = meta.name || s.real.split("/").pop();
    s.description = meta.description ?? "";
    s.body = text === null ? null : body;
  }));
  return skills;
}

async function scan(repo) {
  const h = home();
  const src = [["Agents", `${h}/.agents/skills`], ["Claude", `${h}/.claude/skills`], ["OpenCode", `${h}/.config/opencode/skills`], ["Codex", `${h}/.codex/skills`]];
  if (repo && repo !== h) src.push(["Project", `${repo}/.agents/skills`], ["Project", `${repo}/.claude/skills`]);
  const r = await exec("sh", ["-c", SCAN, "skills", ...src.flat()], { timeout: 20000 });
  return describe(mergeSkills(rows(r.stdout), ORDER));
}

// Installed Claude Code plugins, each with the skills it ships (many add only hooks, MCP or language servers).
async function scanPlugins() {
  let installed;
  try { installed = JSON.parse(await readTextFile(`${home()}/.claude/plugins/installed_plugins.json`)).plugins; } catch { return []; }
  const paths = Object.values(installed ?? {}).flat().map((e) => e?.installPath).filter(Boolean);
  const found = new Set((await exec("sh", ["-c", EXISTS, "skills", ...paths])).stdout.split("\n"));
  const plugins = pickPlugins(installed, (p) => found.has(p));
  const r = await exec("sh", ["-c", SCAN, "skills", ...plugins.flatMap((p) => [p.id, `${p.root}/skills`])], { timeout: 20000 });
  const skills = await describe(mergeSkills(rows(r.stdout), plugins.map((p) => p.id)));
  await Promise.all(plugins.map(async (p) => {
    let meta = {};
    try { meta = JSON.parse(await readTextFile(`${p.root}/.claude-plugin/plugin.json`)) ?? {}; } catch {} // a missing file reads as null
    p.description = meta.description ?? "";
    p.version = meta.version || p.version;
    p.real = p.root;
    p.skills = skills.filter((s) => s.sources[0] === p.id).map((s) => ({ ...s, sources: [p.name] }));
  }));
  return plugins;
}

// Resolved listings only: a window never awaits work the (closing) palette started.
async function listing(dir) {
  if (!listings.has(dir)) listings.set(dir, parseListing((await exec("sh", ["-c", LIST, "skills", dir])).stdout, "."));
  return listings.get(dir);
}

// A plugin's own folder, opened in the skill window (its README first).
const rootOf = (p) => ({ real: p.root, name: p.name, sources: [p.marketplace].filter(Boolean) });

function chips(t, sources) {
  return h_flex().flex_none().gap(4).children(sources.map((s) =>
    h_flex().h(20).px(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.raised).text_size(11).text_color(t.muted).child(s)));
}

function quiet(t, text) {
  return div().p(16).text_size(12).text_color(t.muted).child(text);
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const found = find(child, id); if (found) return found; }
  return null;
}
// The panel copy lives on while its column is hidden or another panel is in front.
// A shown panel node has no `hidden` key at all, so test for falsy, not `=== false`.
const shown = () => { const p = find(layout(), "panel"); return !!p && !p.hidden && find(layout(), "panel-body")?.active === "skills"; };

export default class Skills extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.overlay = props()?.overlay;
    if (props()?.role === "window") return this.initWindow(props(), cx);
    // Panel role (props.panel): a side panel in the layout's `panel` column; scans on show, follows the focused repo.
    this.panel = props()?.panel === true;
    this.query = "";
    this.at = 0;
    this.tab = localStorage.getItem("tab") === "plugins" ? "plugins" : "skills";
    this.plugin = null; // id of the plugin whose skills are listed (Plugins tab)
    this.lists = new Map();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Search…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; this.scroll.scroll_to_item(0); cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.open(this.results()[this.at]); cx.notify(); });
    if (this.panel) return;
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.cwd = focused()?.cwd ?? null;
    this.load(cx, false);
  }

  load(cx, fresh) {
    if (fresh) { listings.clear(); this.lists.clear(); }
    this.error = null;
    this.loading = true;
    cx.spawn(async (cx) => {
      await cx.sleep(16); // the panel scans from its first render; host calls before a copy's first frame never resolve
      try {
        const machine = spaces().find((s) => s.active)?.machine ?? null;
        // ponytail: project skills only for local panes; remote spaces would need `on:` reads everywhere.
        const top = this.cwd && !machine ? await exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.cwd }).catch(() => null) : null;
        const repo = top?.code === 0 ? top.stdout.trim() : null;
        if (fresh || !cache || cache.repo !== repo) { const [skills, plugins] = await Promise.all([scan(repo), scanPlugins()]); cache = { repo, skills, plugins }; }
      } catch (e) {
        this.error = `Couldn't read your skills: ${e?.message ?? e}`;
      }
      this.loading = false;
      cx.notify();
    });
  }

  // Skills tab: every skill. Plugins tab: the plugins, or one plugin's skills once opened.
  results() {
    if (!cache) return [];
    if (this.tab === "skills") return rankSkills(cache.skills, this.query);
    return rankSkills(this.openPlugin()?.skills ?? cache.plugins, this.query);
  }

  openPlugin() {
    return this.tab === "plugins" && this.plugin ? cache?.plugins.find((p) => p.id === this.plugin) ?? null : null;
  }

  // Moves between tabs and into / out of a plugin; the search starts over at each place.
  goto(tab, plugin) {
    const from = this.plugin;
    if (tab !== this.tab) localStorage.setItem("tab", tab);
    this.tab = tab;
    this.plugin = plugin;
    this.query = "";
    this.input.set_value(""); // doesn't fire "change"
    this.at = from && !plugin ? Math.max(0, this.results().findIndex((p) => p.id === from)) : 0; // back lands on the plugin
    this.scroll.scroll_to_item(this.at);
  }

  // A plugin with skills lists them; one without (hooks, MCP, LSP only) opens its files; a skill opens its window.
  open(item) {
    if (item?.skills?.length) this.goto("plugins", item.id);
    else this.popOut(item?.skills ? rootOf(item) : item);
  }

  // One skill window: opening another skill replaces it in place (same key).
  popOut(s, file) {
    if (!s) return;
    openOverlay({ kind: "window", mod: "skills", key: "skill", width: 760, height: 0.8, props: { role: "window", path: s.real, name: s.name, sources: s.sources, file } });
    if (this.overlay) closeOverlay(this.overlay);
  }

  render(cx) {
    return this.dir ? this.renderWindow(cx) : this.renderPalette(cx);
  }

  renderPalette(cx) {
    const panel = this.panel, wide = !panel || (this.width ?? 0) >= 720;
    if (panel && shown() && !this.loading) {
      // Like Changes: follow the focused terminal's folder (a focused mod has none). this.cwd starts undefined, so the first show scans.
      const f = focused(), cwd = f?.terminal ? (f.cwd ?? null) : (this.cwd ?? null);
      if (cwd !== this.cwd) { this.cwd = cwd; this.load(cx, false); }
    }
    const t = theme(), list = this.results(), plugin = this.openPlugin();
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    const sel = wide ? list[this.at] : null;
    if (sel && !this.lists.has(sel.real)) {
      this.lists.set(sel.real, null);
      cx.spawn(async (cx) => { await cx.sleep(16); this.lists.set(sel.real, await listing(sel.real).catch(() => [])); cx.notify(); });
    }
    const files = sel ? this.lists.get(sel.real) : null;
    const move = (d, cx) => { this.at = Math.max(0, Math.min(this.at + d, list.length - 1)); this.scroll.scroll_to_item(this.at); cx.notify(); };
    const total = !cache ? 0 : this.tab === "skills" ? cache.skills.length : (plugin?.skills ?? cache.plugins).length;
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

    // Rows: a click selects (wide) or opens (narrow); a double click always opens.
    const pick = (el, i, item) => el.mx(6).px(12).py(10).gap(4).rounded(8).cursor_pointer()
      .when(i === this.at, (el) => el.bg(t.selected)).when(i !== this.at, (el) => el.hover((st) => st.bg(t.hover)))
      .on_click((e, cx) => { if (e.click_count === 2 || !wide) this.open(item); else this.at = i; cx.notify(); });
    const blurb = (text) => { const d = text.replace(/\s+/g, " ").trim(); return div().max_h(34).overflow_hidden().text_size(12).line_height("17px").text_color(t.muted).child(d.length > 104 ? `${d.slice(0, 100).trimEnd()}…` : d); };
    const row = (s, i) => pick(v_flex().id(`sk-${s.real}`), i, s)
      .child(h_flex().h(20).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(s.name))
        .child(chips(t, plugin ? [] : s.sources)))
      .when(Boolean(s.description.trim()), (el) => el.child(blurb(s.description)));
    const pluginRow = (p, i) => pick(v_flex().id(`pl-${p.id}`), i, p)
      .child(h_flex().h(20).gap(8).items_center()
        .child(icon("plugin").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(p.name))
        .child(chips(t, [p.skills.length ? plural(p.skills.length, "skill") : "no skills"])))
      .when(Boolean(p.description.trim()), (el) => el.child(blurb(p.description)))
      .child(div().truncate().text_size(11).font_family(MONO).text_color(t.dim).child([/^\d/.test(p.version) ? `v${p.version}` : p.version, p.marketplace].filter(Boolean).join(" · ")));

    // Wide: the selected skill's SKILL.md, or the selected plugin and its skills.
    const head = (title, action) => h_flex().flex_none().px(20).pt(16).pb(12).gap(16).items_start().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().truncate().text_size(15).font_semibold().text_color(t.foreground).child(title))
        .child(h_flex().gap(8).text_size(11).text_color(t.dim)
          .child(div().min_w(0).text_ellipsis_start().whitespace_nowrap().overflow_hidden().font_family(MONO).child(tilde(sel.real)))
          .child(div().flex_none().child(files ? plural(files.length, "file") : "…"))))
      .child(h_flex().id("sk-open").flex_none().h(28).px(12).gap(6).items_center().rounded(6).bg(t.accent).text_color(t.accent_foreground)
        .text_size(12).cursor_pointer().hover((st) => st.opacity(0.9)).on_click((_e, cx) => { this.open(sel); cx.notify(); })
        .child(icon("open").size(13)).child(action).child(div().text_size(11).opacity(0.7).child("↵")));
    const skillBody = (s) => s.body === null ? quiet(t, "SKILL.md is unreadable or larger than 1 MB.") :
      v_flex().id("sk-preview").flex_1().min_h(0).overflow_y_scrollbar().px(20).py(16).text_size(13).text_color(t.foreground)
        .child(TextView.markdown(`pv-${s.real}`, s.body).selectable(true).on_link_click((url, cx) => {
          const f = resolveLink(url, (files ?? []).map((x) => x.path), "SKILL.md");
          if (f) this.popOut(s, f); else cx.open_url(url);
        }));
    const pluginBody = (p) => v_flex().id("pl-preview").flex_1().min_h(0).overflow_y_scrollbar().px(20).py(16).gap(12)
      .when(Boolean(p.description), (el) => el.child(div().text_size(13).line_height("20px").text_color(t.muted).child(p.description)))
      .child(div().text_size(11).text_color(t.dim).child(p.skills.length ? "Skills" : "No skills: this plugin adds hooks, MCP or language servers. Open browses its files."))
      .child(v_flex().gap(2).children(p.skills.map((s) => h_flex().id(`pls-${s.real}`).h(32).px(10).gap(10).items_center().rounded(6).cursor_pointer()
        .hover((st) => st.bg(t.hover)).on_click(() => this.popOut(s))
        .child(icon("doc").size(14).flex_none().text_color(t.dim))
        .child(div().flex_none().text_size(13).text_color(t.foreground).child(s.name))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(s.description.replace(/\s+/g, " "))))));
    const preview = !sel ? v_flex().flex_1() : v_flex().flex_1().min_w(0).min_h(0).bg(t.background)
      .child(head(sel.name, sel.skills?.length ? "Open" : sel.skills ? "Files" : "Open"))
      .child(sel.skills ? pluginBody(sel) : skillBody(sel));

    const tabs = h_flex().flex_none().px(10).py(8).border_b(1).border_color(t.border).child(h_flex().flex_1().h(28).p(2).gap(2).rounded(8).bg(t.raised)
      .children([["skills", "Skills", cache?.skills.length], ["plugins", "Plugins", cache?.plugins.length]].map(([k, label, n]) =>
        h_flex().id(`tab-${k}`).flex_1().h_full().gap(6).items_center().justify_center().rounded(6).text_size(12).cursor_pointer()
          .when(this.tab === k, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
          .when(this.tab !== k, (el) => el.text_color(t.muted).hover((x) => x.text_color(t.foreground)))
          .on_click((_e, cx) => { if (this.tab !== k || this.plugin) this.goto(k, null); cx.notify(); })
          .child(label).when(n != null, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(n)))))));
    const crumbs = plugin && h_flex().h(36).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border).text_size(12)
      .child(h_flex().id("pl-back").h(26).px(6).gap(4).items_center().rounded(6).cursor_pointer().text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { this.goto("plugins", null); cx.notify(); })
        .child(icon("back").size(14)).child("Plugins"))
      .child(div().text_color(t.dim).child("/"))
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(plugin.name))
      .child(h_flex().id("pl-files").h(26).px(8).gap(6).items_center().rounded(6).cursor_pointer().text_color(t.muted).tooltip("The plugin's own files")
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.popOut(rootOf(plugin)))
        .child(icon("doc").size(13)).child("Files"));

    const empty = this.error ?? (this.loading && !cache ? "Scanning…" : this.query ? `Nothing matches “${this.query}”.`
      : this.tab === "skills" ? "No skills in ~/.agents, ~/.claude, ~/.config/opencode or ~/.codex." : "No Claude Code plugins installed.");
    const key = (k) => div().px(5).h(18).flex().items_center().rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(k);
    const keys = (e, cx) => {
      if (e.key === "escape" && this.plugin) { this.goto("plugins", null); cx.notify(); }
      else if (e.key === "escape" && !panel) closeOverlay(this.overlay);
      else if (e.key === "down") move(1, cx);
      else if (e.key === "up") move(-1, cx);
      else if (e.key === "r" && e.modifiers.platform) this.load(cx, true);
      else return;
      cx.stop_propagation();
    };
    const rowOf = this.tab === "plugins" && !plugin ? pluginRow : row;
    const body = h_flex().flex_1().min_h(0).items_stretch()
      .child(v_flex().id("sk-list").when(wide, (el) => el.w(340).flex_none().border_r(1).border_color(t.border)).when(!wide, (el) => el.flex_1().min_w(0))
        .min_h(0).py(6).gap(2).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(list.length ? list.map(rowOf) : [quiet(t, empty)]))
      .when(wide, (el) => el.child(preview));
    const count = cache && this.query ? `${list.length} of ${total}` : "";

    if (panel) {
      const button = (id, name, tip, onClick) => h_flex().id(id).flex_none().size(24).items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(onClick)
        .child(icon(name).size(14).when(name === "refresh" && this.loading, (el) => el.spin(900)));
      return v_flex().id("skills").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
        .text_color(t.foreground).text_size(13).on_key_down(keys)
        .on_size_change((size, cx) => { this.width = size.width / (settings().zoom ?? 1); cx.notify(); })
        .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
          .child(div().text_size(13).font_semibold().child("Library"))
          .child(div().text_size(11).text_color(t.dim).child(count))
          .child(div().flex_1())
          .child(button("sk-rescan", "refresh", "Rescan  ⌘R", (_e, cx) => this.load(cx, true)))
          .child(button("sk-expand", "expand", "Open as palette", () => run("mod.open", { name: "skills" }))))
        .child(h_flex().h(40).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
          .child(icon("search").size(14).flex_none().text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
        .child(tabs)
        .when(Boolean(crumbs), (el) => el.child(crumbs))
        .child(body);
    }

    // A popup sizes to its content (up to mod.json's height), so ask for that height outright.
    const h = Math.floor((window.viewport_size().height * 0.78) / (settings().zoom ?? 1));
    return v_flex().id("skills").track_focus(this.handle).w_full().h(h).min_h(0).bg(t.surface).text_color(t.foreground)
      .on_key_down(keys)
      .child(h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(icon("search").size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(15).text_color(t.foreground))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(count))
        .child(div().id("sk-esc").flex_none().cursor_pointer().on_click(() => closeOverlay(this.overlay)).child(key("esc"))))
      .child(tabs)
      .when(Boolean(crumbs), (el) => el.child(crumbs))
      .child(body)
      .child(h_flex().h(32).flex_none().px(16).gap(16).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(h_flex().gap(6).items_center().child(key("↑")).child(key("↓")).child("move"))
        .child(h_flex().gap(6).items_center().child(key("↵")).child("open"))
        .child(h_flex().gap(6).items_center().child(key("⌘R")).child(this.loading && cache ? "rescanning…" : "rescan"))
        .child(div().flex_1())
        .when(Boolean(cache?.repo), (el) => el.child(div().font_family(MONO).truncate().child(`+ ${tilde(cache.repo)}`))));
  }

  // ── Window role ────────────────────────────────────────────────────────────

  initWindow(p, cx) {
    this.dir = p.path;
    this.name = p.name ?? p.path.split("/").pop();
    this.sources = p.sources ?? [];
    this.files = null;
    cx.timer.after(50, () => this.handle.focus());
    // `herdr-app do skills.close` closes the skill window (scripts, agents).
    cx.spawn(async () => { for (;;) if ((await nextCommand()) === "close") closeOverlay(this.overlay); });
    cx.spawn(async (cx) => {
      await cx.sleep(16); // host reads started before the window's first frame never resolve (seen live)
      try { this.files = await listing(this.dir); } catch (e) { this.listError = `Couldn't list this skill: ${e?.message ?? e}`; }
      const has = (f) => f && this.files?.some((x) => x.path === f);
      await this.read([p.file, "SKILL.md", "README.md"].find(has) ?? this.files?.find((x) => fileKind(x.path) === "md")?.path ?? "SKILL.md");
      cx.notify();
    });
  }

  // A link in the shown markdown: a file of this skill switches the view; anything else opens outside.
  follow(url, cx) {
    const f = resolveLink(url, (this.files ?? []).map((x) => x.path), this.view?.path ?? "SKILL.md");
    if (f) this.show(f, cx); else cx.open_url(url);
  }

  show(path, cx) {
    cx.spawn(async (cx) => { await this.read(path); cx.notify(); });
  }

  // Makes `path` the shown file and loads it; a newer pick wins over a slower read.
  async read(path) {
    const f = this.files?.find((x) => x.path === path), kind = fileKind(path);
    this.code?.release();
    this.code = null;
    const view = (this.view = { path, text: null, note: null });
    if (!f) return void (view.note = "This file is gone.");
    if (kind === "asset") return void (view.note = `${formatSize(f.size)} · binary asset, not previewed.`);
    if (f.size > MAX) return void (view.note = `${formatSize(f.size)} · larger than 1 MB, not shown.`);
    let text = null;
    try { text = await readTextFile(`${this.dir}/${path}`); } catch {}
    if (this.view !== view) return;
    if (text === null) view.note = "This file couldn't be read.";
    else if (text.includes("\0")) view.note = `${formatSize(f.size)} · binary file, not previewed.`;
    else if (kind === "md") { const fm = parseFrontMatter(text); view.text = fm.body; view.meta = fm.meta; }
    else {
      const t = theme(), ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "txt";
      this.code = EditorState.new({ language: LANG[ext] ?? ext, value: text, readonly: true, font_family: MONO, font_size: 12,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 } });
    }
  }

  renderWindow(cx) {
    const t = theme(), files = this.files ?? [], cur = this.view?.path;
    const close = () => closeOverlay(this.overlay);
    const step = (d, cx) => {
      const i = files.findIndex((f) => f.path === cur);
      const next = files[Math.max(0, Math.min(i + d, files.length - 1))];
      if (next && next.path !== cur) { this.show(next.path, cx); cx.notify(); }
    };
    const group = (f) => (fileKind(f.path) === "md" ? "Docs" : fileKind(f.path) === "asset" ? "Assets" : f.path.startsWith("scripts/") ? "Scripts" : "Files");
    const strip = [];
    let last = null;
    for (const f of files) {
      const g = group(f), on = f.path === cur, kind = fileKind(f.path);
      if (g !== last) strip.push(div().px(18).pt(strip.length ? 16 : 4).pb(4).text_size(11).text_color(t.dim).child(g));
      last = g;
      const label = g === "Scripts" ? f.path.slice(8) : f.path.startsWith("references/") ? f.path.slice(11) : f.path;
      strip.push(h_flex().id(`f-${f.path}`).mx(6).h(32).px(12).gap(8).items_center().rounded(6).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => { this.show(f.path, cx); cx.notify(); })
        .child(icon(kind === "md" ? "doc" : kind === "asset" ? "asset" : "code").size(14).flex_none().text_color(on ? t.foreground : t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(on ? t.foreground : t.muted).child(label))
        .when(kind === "asset", (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(formatSize(f.size)))));
    }

    const v = this.view, fileInfo = files.find((f) => f.path === cur);
    let content;
    if (this.listError) content = quiet(t, this.listError);
    else if (!v) content = quiet(t, "Loading skill…");
    else if (v.note) content = v_flex().flex_1().items_center().justify_center().gap(4)
      .child(div().text_size(13).text_color(t.muted).child(v.note))
      .child(div().text_size(11).font_family(MONO).text_color(t.dim).child(cur));
    else if (this.code) content = v_flex().flex_1().min_w(0).min_h(0)
      .child(h_flex().h(32).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(MONO).text_color(t.muted).child(cur))
        .child(div().text_size(11).text_color(t.dim).child(fileInfo ? formatSize(fileInfo.size) : "")))
      .child(Editor.new(this.code).flex_1().min_h(0));
    else if (v.text === null) content = quiet(t, "Loading…");
    else {
      const skillMd = cur === "SKILL.md", desc = skillMd ? v.meta?.description : null;
      content = v_flex().id(`md-scroll-${cur}`).flex_1().min_w(0).min_h(0).overflow_y_scrollbar()
        .child(v_flex().w_full().max_w(720).px(24).py(20).gap(16)
          .child(skillMd
            ? v_flex().p(12).gap(8).rounded(10).border_1().border_color(t.border).bg(t.surface)
              .when(Boolean(desc), (el) => el.child(div().text_size(13).line_height("20px").text_color(t.muted).child(desc)))
              .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
                .child(div().flex_1().min_w(0).text_ellipsis_start().whitespace_nowrap().overflow_hidden().font_family(MONO).child(tilde(this.dir)))
                .child(div().flex_none().child(`${files.length} file${files.length === 1 ? "" : "s"}`)))
            : div().text_size(11).font_family(MONO).text_color(t.dim).child(cur))
          .child(div().text_size(13).text_color(t.foreground).child(TextView.markdown(`md-${this.dir}/${cur}`, v.text).selectable(true)
            .on_link_click((url, cx) => this.follow(url, cx)))));
    }

    return v_flex().id("skill-window").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") close();
        else if (e.key === "down") step(1, cx);
        else if (e.key === "up") step(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(40).flex_none().pl(16).pr(8).gap(10).items_center().border_b(1).border_color(t.border).bg(t.surface)
        .child(div().min_w(0).truncate().text_size(15).font_semibold().child(this.name))
        .child(chips(t, this.sources))
        .child(div().flex_1())
        .child(h_flex().id("skw-close").flex_none().size(24).items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(close)
          .child(icon("close").size(14))))
      .child(h_flex().flex_1().min_h(0).items_stretch().on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); })
        .child(v_flex().id("skw-files").w(232).flex_none().min_h(0).py(8).gap(2).bg(t.surface).border_r(1).border_color(t.border).overflow_y_scrollbar()
          .children(this.files ? strip : [quiet(t, this.listError ? "" : "Loading files…")]))
        .child(content));
  }
}
