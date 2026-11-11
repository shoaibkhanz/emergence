// Skills: every agent skill on this machine (and in the focused repo), searchable, readable.
// Palette popup (mod.open:skills): search, list, SKILL.md preview; Enter pops the skill into a window.
// Window role (props.role === "window"): SKILL.md, references and scripts of one skill.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, Editor, EditorState, ScrollHandle } from "gpui-base";
import { exec, home, focused, spaces, theme, settings, props, openOverlay, closeOverlay, readTextFile, nextCommand } from "herdr";
import { parseFrontMatter, mergeSkills, rankSkills, fileKind, parseListing, resolveLink, formatSize } from "./lib.js";

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

// Shared by every copy and kept after the palette closes, so reopening is instant (⌘R rescans).
let cache = null;
const listings = new Map();

async function scan(repo) {
  const h = home();
  const src = [["Agents", `${h}/.agents/skills`], ["Claude", `${h}/.claude/skills`], ["OpenCode", `${h}/.config/opencode/skills`], ["Codex", `${h}/.codex/skills`]];
  if (repo && repo !== h) src.push(["Project", `${repo}/.agents/skills`], ["Project", `${repo}/.claude/skills`]);
  const r = await exec("sh", ["-c", SCAN, "skills", ...src.flat()], { timeout: 20000 });
  const rows = r.stdout.split("\n").filter(Boolean).map((l) => { const [source, dir, real] = l.split("\t"); return { source, dir, real }; });
  const skills = mergeSkills(rows, ORDER);
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

// Resolved listings only: a window never awaits work the (closing) palette started.
async function listing(dir) {
  if (!listings.has(dir)) listings.set(dir, parseListing((await exec("sh", ["-c", LIST, "skills", dir])).stdout, "."));
  return listings.get(dir);
}

function chips(t, sources) {
  return h_flex().flex_none().gap(4).children(sources.map((s) =>
    h_flex().h(20).px(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.raised).text_size(11).text_color(t.muted).child(s)));
}

function quiet(t, text) {
  return div().p(16).text_size(12).text_color(t.muted).child(text);
}

export default class Skills extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.overlay = props()?.overlay;
    if (props()?.role === "window") return this.initWindow(props(), cx);
    this.query = "";
    this.at = 0;
    this.lists = new Map();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Search skills…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; this.scroll.scroll_to_item(0); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.popOut(cx, this.results()[this.at]));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.load(cx, false);
  }

  load(cx, fresh) {
    if (fresh) { listings.clear(); this.lists.clear(); }
    this.error = null;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const f = focused(), machine = spaces().find((s) => s.active)?.machine ?? null;
        // ponytail: project skills only for local panes; remote spaces would need `on:` reads everywhere.
        const top = f?.cwd && !machine ? await exec("git", ["rev-parse", "--show-toplevel"], { cwd: f.cwd }).catch(() => null) : null;
        const repo = top?.code === 0 ? top.stdout.trim() : null;
        if (fresh || !cache || cache.repo !== repo) cache = { repo, skills: await scan(repo) };
      } catch (e) {
        this.error = `Couldn't read your skills: ${e?.message ?? e}`;
      }
      this.loading = false;
      cx.notify();
    });
  }

  results() {
    return cache ? rankSkills(cache.skills, this.query) : [];
  }

  popOut(cx, s, file) {
    if (!s) return;
    const v = window.viewport_size(), z = settings().zoom ?? 1;
    cx.spawn(async () => {
      // Each further skill window steps 40px down-right from the centre, so none hides another.
      let n = 0;
      try { n = JSON.parse((await exec("herdr-app", ["status"])).stdout).overlays.filter((o) => o === "skills").length - 1; } catch {}
      const at = n > 0 ? { x: Math.round((v.width - 760 * z) / 2 + 40 * n), y: Math.round(v.height * 0.1 + 40 * n) } : undefined;
      openOverlay({ kind: "window", mod: "skills", key: `skill:${s.real}`, width: 760, height: 0.8, at, props: { role: "window", path: s.real, name: s.name, sources: s.sources, file } });
      closeOverlay(this.overlay);
    });
  }

  render(cx) {
    return this.dir ? this.renderWindow(cx) : this.renderPalette(cx);
  }

  renderPalette(cx) {
    const t = theme(), list = this.results();
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    const sel = list[this.at];
    if (sel && !this.lists.has(sel.real)) {
      this.lists.set(sel.real, null);
      cx.spawn(async (cx) => { this.lists.set(sel.real, await listing(sel.real).catch(() => [])); cx.notify(); });
    }
    const files = sel ? this.lists.get(sel.real) : null;
    const move = (d, cx) => { this.at = Math.max(0, Math.min(this.at + d, list.length - 1)); this.scroll.scroll_to_item(this.at); cx.notify(); };

    const row = (s, i) => {
      const on = i === this.at, d = s.description.replace(/\s+/g, " ");
      return v_flex().id(`sk-${s.real}`).mx(6).px(12).py(10).gap(4).rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click((e, cx) => { if (e.click_count === 2) return this.popOut(cx, s); this.at = i; cx.notify(); })
        .child(h_flex().h(20).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(s.name))
          .child(chips(t, s.sources)))
        .when(Boolean(d), (el) => el.child(div().max_h(34).overflow_hidden().text_size(12).line_height("17px").text_color(t.muted)
          .child(d.length > 104 ? `${d.slice(0, 100).trimEnd()}…` : d)));
    };

    const preview = !sel ? v_flex().flex_1() : v_flex().flex_1().min_w(0).min_h(0).bg(t.background)
      .child(h_flex().flex_none().px(20).pt(16).pb(12).gap(16).items_start().border_b(1).border_color(t.border)
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().truncate().text_size(15).font_semibold().text_color(t.foreground).child(sel.name))
          .child(h_flex().gap(8).text_size(11).text_color(t.dim)
            .child(div().min_w(0).text_ellipsis_start().whitespace_nowrap().overflow_hidden().font_family(MONO).child(tilde(sel.real)))
            .child(div().flex_none().child(files ? `${files.length} file${files.length === 1 ? "" : "s"}` : "…"))))
        .child(h_flex().id("sk-open").flex_none().h(28).px(12).gap(6).items_center().rounded(6).bg(t.accent).text_color(t.accent_foreground)
          .text_size(12).cursor_pointer().hover((st) => st.opacity(0.9)).on_click((_e, cx) => this.popOut(cx, sel))
          .child(icon("open").size(13)).child("Open").child(div().text_size(11).opacity(0.7).child("↵"))))
      .child(sel.body === null ? quiet(t, "SKILL.md is unreadable or larger than 1 MB.") :
        v_flex().id("sk-preview").flex_1().min_h(0).overflow_y_scrollbar().px(20).py(16).text_size(13).text_color(t.foreground)
          .child(TextView.markdown(`pv-${sel.real}`, sel.body).selectable(true).on_link_click((url, cx) => {
            const f = resolveLink(url, (files ?? []).map((x) => x.path), "SKILL.md");
            if (f) this.popOut(cx, sel, f); else cx.open_url(url);
          })));

    const empty = this.error ?? (this.loading && !cache ? "Scanning skills…" : !cache?.skills.length ? "No skills in ~/.agents, ~/.claude, ~/.config/opencode or ~/.codex." : `No skills match “${this.query}”.`);
    const key = (k) => div().px(5).h(18).flex().items_center().rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(k);

    // A popup sizes to its content (up to mod.json's height), so ask for that height outright.
    const h = Math.floor((window.viewport_size().height * 0.78) / (settings().zoom ?? 1));
    return v_flex().id("skills").track_focus(this.handle).w_full().h(h).min_h(0).bg(t.surface).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(this.overlay);
        else if (e.key === "down") move(1, cx);
        else if (e.key === "up") move(-1, cx);
        else if (e.key === "r" && e.modifiers.platform) this.load(cx, true);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(icon("search").size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(15).text_color(t.foreground))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(cache ? `${list.length} of ${cache.skills.length}` : ""))
        .child(div().id("sk-esc").flex_none().cursor_pointer().on_click(() => closeOverlay(this.overlay)).child(key("esc"))))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .child(v_flex().id("sk-list").w(340).flex_none().min_h(0).py(6).gap(2).border_r(1).border_color(t.border).overflow_y_scrollbar().track_scroll(this.scroll)
          .children(list.length ? list.map(row) : [quiet(t, empty)]))
        .child(preview))
      .child(h_flex().h(32).flex_none().px(16).gap(16).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(h_flex().gap(6).items_center().child(key("↑")).child(key("↓")).child("move"))
        .child(h_flex().gap(6).items_center().child(key("↵")).child("open in window"))
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
    // `herdr-app do skills.close` closes every open skill window (scripts, agents).
    cx.spawn(async () => { for (;;) if ((await nextCommand()) === "close") closeOverlay(this.overlay); });
    cx.spawn(async (cx) => {
      await cx.sleep(16); // host reads started before the window's first frame never resolve (seen live)
      try { this.files = await listing(this.dir); } catch (e) { this.listError = `Couldn't list this skill: ${e?.message ?? e}`; }
      await this.read(this.files?.some((f) => f.path === p.file) ? p.file : "SKILL.md");
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
