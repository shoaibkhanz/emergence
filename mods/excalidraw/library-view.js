// herdr-mods: the Excalidraw library (ported from the retired Diagrams library): a movable window over every drawing in
// <appHome>/data/excalidraw, this repo's first. Search, This repo | Pinned | All, a preview per row; ↵ opens it in the
// side panel (or a big window when the layout has none), ⌘S pins, ⌘R renames, ⌘K picks its repos, ⌘⌫ moves it to the
// trash (back for 30 days); the selected row has buttons for each; Esc closes. Herdr's global ⌘P / ⌘D are left alone.
// House style: the settings dialog's frame, section cards with hairline rows (RECIPE "Dialogs").

import { div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, openOverlay, theme, panes, focused, watchFolder, home } from "herdr";
import { sections, search, repoName, freeName, ago, knownRepos, toggleRepo } from "./library.js";
import { dir, scan, readIndex, setEntry, trash, duplicate, create, repoOf } from "./store.js";
import { showInPanel, openWindow } from "./open.js";

const ROW = 60;

export class LibraryView {
  constructor(cx) {
    const p = props() ?? {};
    this.repo = null; // { key, path, remote, branch } of the focused pane's checkout, when it's in one
    this.tab = "all";
    this.cursor = 0;
    this.entries = [];
    this.focus = cx.focus_handle();
    this.focus.focus();
    this.query = InputState.new();
    this.query.on("change", (_e, cx) => { this.cursor = 0; cx.notify(); });
    this.query.on("submit", (_e, cx) => this.open(this.rows()[this.cursor], cx));
    this.renameInput = InputState.new();
    this.renameInput.on("submit", (_e, cx) => this.commitRename(cx));
    this.renameInput.on("blur", (_e, cx) => this.commitRename(cx));
    this.pathInput = InputState.new(); // the repo picker's "add a folder"
    this.pathInput.on("submit", (_e, cx) => this.addRepoPath(cx));
    cx.timer.after(150, () => this.query.focus());
    cx.spawn(async (cx) => {
      const pane = panes().find((x) => x.id === focused()?.pane && x.cwd) ?? panes().find((x) => x.cwd);
      this.repo = await repoOf(pane?.cwd).catch(() => null);
      if (this.repo) this.tab = "repo";
      try { this.take(await scan()); } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
      for (;;) { // the folder changed (an agent, the canvas, another copy): read the index again
        const changed = await watchFolder(dir());
        try { this.take(changed.some((f) => f.endsWith(".excalidraw")) ? await scan() : (await readIndex()).index); } catch { /* keep what's shown */ }
        cx.notify();
      }
    });
  }
  take(index) {
    this.entries = Object.entries(index.files ?? {}).filter(([, e]) => e.deleted == null).map(([name, e]) => ({ name, title: name, repos: [], tags: [], updated: 0, ...e }));
  }
  // The rows in order: a search's flat list, else the sections' rows.
  view() {
    const q = this.query.value();
    if (q.trim()) return [{ key: "results", rows: search(this.entries, q) }];
    return sections(this.entries, this.repo?.key ?? null, this.tab);
  }
  rows() { return this.view().flatMap((s) => s.rows); }

  close() { closeOverlay(props().overlay); }
  // Opens in the Excalidraw side panel (shown if hidden), else in the big window.
  open(row, cx) {
    if (!row) return;
    const file = `${dir()}/${row.name}`;
    setEntry(row.name, { opened: Date.now() });
    cx.spawn(async () => { if (!(await showInPanel(file))) openWindow(file); this.close(); });
  }
  // The folder picker (the mod's own, for drawings outside the library's folder).
  chooseFolder() { openOverlay({ mod: "excalidraw", kind: "window", key: "excalidraw-picker", width: 560, height: 0.7, props: { picker: true } }); this.close(); }
  act(row, what, cx) {
    if (!row) return;
    cx.spawn(async (cx) => {
      if (what === "pin") await setEntry(row.name, { pinned: !row.pinned });
      if (what === "duplicate") await duplicate(row.name, freeName(null, row.name.replace(/\.excalidraw$/, "") + " copy", this.entries.map((e) => e.name)), row);
      if (what === "trash") await trash(row.name);
      if (what?.repo) await setEntry(row.name, { repos: toggleRepo(row.repos, what.repo) });
      this.take((await readIndex()).index);
      cx.notify();
    });
  }
  newDrawing(cx) {
    const name = freeName(this.repo ? repoName(this.repo.key) : null, "untitled", this.entries.map((e) => e.name));
    cx.spawn(async (cx) => { await create(name, "Untitled", this.repo); this.open({ name }, cx); });
  }
  startRename(row) { this.renaming = row.name; this.renameInput.set_value(row.title); this.renameInput.set_selected_range({ start: 0, end: row.title.length }); this.renameInput.focus(); }
  commitRename(cx) {
    const name = this.renaming, title = this.renameInput.value().trim();
    if (!name) return;
    this.renaming = null;
    this.focus.focus();
    if (title) cx.spawn(async (cx) => { await setEntry(name, { title, named: true }); this.take((await readIndex()).index); cx.notify(); });
    cx.notify();
  }

  // The repo picker, under a row: the repos it's filed under, ticked; any known repo, or a folder typed in, toggles.
  pick(row, cx) { this.picking = this.picking === row?.name ? null : row?.name ?? null; this.pickError = null; this.pathInput.set_value(""); cx.notify(); }
  addRepoPath(cx) {
    const row = this.entries.find((e) => e.name === this.picking), raw = this.pathInput.value().trim();
    if (!row || !raw) return;
    cx.spawn(async (cx) => {
      const repo = await repoOf(raw.startsWith("~/") ? home() + raw.slice(1) : raw);
      if (!repo) this.pickError = `${raw} isn't in a git repo`;
      else { this.pickError = null; this.pathInput.set_value(""); if (!row.repos.some((r) => r.key === repo.key)) this.act(row, { repo }, cx); }
      cx.notify();
    });
  }

  key(e, cx) {
    const k = e.keystroke.replace(/^fn-/, ""); // Esc can come as fn-escape (some Mac keyboards)
    if (this.picking || this.renaming) { if (k === "escape") { this.picking = this.renaming = null; this.focus.focus(); cx.notify(); } return; }
    const rows = this.rows(), row = rows[this.cursor];
    if (k === "escape") return this.close();
    if (k === "down") this.cursor = Math.min(rows.length - 1, this.cursor + 1);
    else if (k === "up") this.cursor = Math.max(0, this.cursor - 1);
    else if (k === "enter") return this.open(row, cx);
    else if (k === "cmd-s") this.act(row, "pin", cx);
    else if (k === "cmd-r") { if (row) this.startRename(row); }
    else if (k === "cmd-k") return this.pick(row, cx);
    else if (k === "cmd-backspace") this.act(row, "trash", cx);
    else return;
    cx.notify();
  }

  render(cx) {
    const t = theme(), view = this.view(), all = view.flatMap((s) => s.rows), now = Date.now();
    const chip = (key) => div().px(6).rounded(4).text_size(11)
      .bg(key === this.repo?.key ? `${t.accent.slice(0, 7)}24` : t.raised).text_color(key === this.repo?.key ? t.accent : t.muted).child(repoName(key));
    const segment = (id, label, on) => div().id(id).h(24).px(12).flex().items_center().rounded(4).text_size(12).cursor_pointer()
      .bg(on ? t.background : t.raised).text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.tab = id.slice(4); this.cursor = 0; cx.notify(); }).child(label);
    let index = 0;
    const row = (r, first) => {
      const i = index++, on = i === this.cursor;
      return h_flex().id(`row-${r.name}`).h(ROW).flex_none().px(12).gap(12).items_center().cursor_pointer()
        .when(!first, (el) => el.border_t_1().border_color(t.border)).when(on, (el) => el.bg(t.hover))
        .on_mouse_move((_e, cx) => { if (this.cursor !== i) { this.cursor = i; cx.notify(); } })
        .on_click((e, cx) => (e.click_count >= 2 ? this.open(r, cx) : (this.cursor = i, cx.notify())))
        .child(div().w(72).h(44).flex_none().rounded(4).border(1).border_color(t.border).bg(t.canvas).overflow_hidden()
          .when(!!r.preview, (el) => el.child(image(`data/excalidraw/${r.preview}`).w(72).h(44))))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(this.renaming === r.name
            ? Input.new(this.renameInput).h(24).px(6).rounded(5).border(1).border_color(t.accent).bg(t.input).text_size(13)
            : h_flex().gap(6).items_center().text_size(13).font_weight(500).child(r.pinned ? div().text_color(t.accent).child("★") : div()).child(div().truncate().child(r.title)))
          .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim).overflow_hidden()
            .children(r.repos.slice(0, 2).map((x) => chip(x.key))).when(r.repos.length > 2, (el) => el.child(div().child(`+${r.repos.length - 2}`)))
            .child(div().truncate().child([`${r.nodes ?? 0} shapes`, r.broken ? `can't read it: ${r.broken}` : null].filter(Boolean).join(" · ")))))
        .when(on && this.renaming !== r.name, (el) => el.child(h_flex().gap(2)
          .children([["pin", r.pinned ? "Unpin" : "Pin"], ["rename", "Rename"], ["duplicate", "Duplicate"], ["trash", "Trash"]].map(([what, label]) =>
            div().id(`${what}-${r.name}`).h(24).px(6).flex().items_center().rounded(5).text_size(11).text_color(what === "trash" ? t.blocked : t.muted)
              .hover((st) => st.bg(t.raised).text_color(what === "trash" ? t.blocked : t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); if (what === "rename") { this.startRename(r); cx.notify(); } else this.act(r, what, cx); }).child(label)))))
        .child(div().id(`repos-${r.name}`).h(24).px(8).flex().items_center().rounded(6).border(1).border_color(this.picking === r.name ? t.accent : t.input)
          .text_size(11).text_color(t.muted).hover((st) => st.text_color(t.foreground)).when(!(on || this.picking === r.name || !r.repos.length), (el) => el.invisible())
          .on_click((_e, cx) => { cx.stop_propagation(); this.pick(r, cx); }).child(r.repos.length ? "Repos" : this.repo ? `Put in ${repoName(this.repo.key)}…` : "Put in a repo…"))
        .child(div().text_size(12).text_color(t.dim).child(ago(r.updated, now)));
    };
    const title = (s) => s.key === "results" ? `${s.rows.length} found` : s.key === "all" ? "Everything" : s.key === null ? "Unfiled"
      : s.key === this.repo?.key ? `This repo · ${repoName(s.key)}` : repoName(s.key);
    return v_flex().id("excalidraw-library").size_full().p(24).gap(14).bg(t.popover).text_color(t.foreground)
      .track_focus(this.focus).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().items_center().justify_between()
        .child(h_flex().gap(8).items_end().child(div().text_size(18).font_weight(600).child("Drawings")).child(div().text_size(13).text_color(t.dim).child(String(this.entries.length))))
        .child(h_flex().gap(8)
          .child(div().id("new").h(28).px(10).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.raised).text_size(12).cursor_pointer()
            .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.newDrawing(cx)).child("+ New drawing"))
          .child(div().id("folder").h(28).px(10).flex().items_center().rounded(6).text_size(12).text_color(t.muted).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.chooseFolder()).child("Choose folder…"))
          .child(div().id("esc").h(28).px(8).flex().items_center().rounded(6).text_size(12).text_color(t.muted).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc"))))
      .child(div().relative().child(Input.new(this.query).h(36).px(12).rounded(8).border(1).border_color(t.input).bg(t.input).text_size(13))
        .when(!this.query.value(), (el) => el.child(div().absolute().left(13).top(0).h(36).flex().items_center().text_size(13).text_color(t.dim).child("Search titles, repos, tags…"))))
      .child(h_flex().items_center().justify_between()
        .child(h_flex().p(2).gap(2).rounded(6).border(1).border_color(t.input).bg(t.raised)
          .when(!!this.repo, (el) => el.child(segment("tab-repo", "This repo", this.tab === "repo")))
          .child(segment("tab-pinned", "Pinned", this.tab === "pinned")).child(segment("tab-all", "All", this.tab === "all")))
        .child(div().text_size(12).text_color(t.dim).child("Newest first")))
      .child(v_flex().id("library-list").flex_1().min_h(0).overflow_y_scroll().gap(12)
        .when(!all.length, (el) => el.child(div().py(24).text_center().text_size(13).text_color(t.dim)
          .child(this.error ?? (this.query.value().trim() ? "Nothing matches." : this.tab === "pinned" ? "Nothing pinned yet: ⌘S pins the selected drawing." : "No drawings yet. Ask an agent to draw one, or make a new one."))))
        .children(view.filter((s) => s.rows.length).map((s) => v_flex().gap(6)
          .child(div().text_size(12).text_color(t.muted).child(title(s)))
          .child(v_flex().rounded(6).border(1).border_color(t.border).bg(t.surface).overflow_hidden()
            .children(s.rows.flatMap((r, i) => (r.name === this.picking ? [row(r, i === 0), this.picker(t, r)] : [row(r, i === 0)])))))))
      .child(div().text_size(12).text_color(t.dim).truncate().child("↑/↓ move · ↵ open · ⌘S pin · ⌘R rename · ⌘K repos · ⌘⌫ trash (30 days) · drag to move"));
  }

  picker(t, r) {
    const repos = knownRepos(this.entries, this.repo);
    return v_flex().id(`picker-${r.name}`).px(12).py(10).gap(6).border_t_1().border_color(t.border).bg(t.raised)
      .child(div().text_size(11).text_color(t.dim).child("Filed under (a repo the file itself names comes back when an agent next edits it)"))
      .children(repos.map((x) => {
        const has = r.repos.some((y) => y.key === x.key);
        return h_flex().id(`pick-${x.key}`).h(26).px(6).gap(8).items_center().rounded(4).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => this.act(r, { repo: x }, cx))
          .child(div().w(14).text_color(t.accent).child(has ? "✓" : ""))
          .child(div().text_size(12).text_color(has ? t.foreground : t.muted).child(repoName(x.key)))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(x.key === this.repo?.key ? `this repo · ${x.key}` : x.key));
      }))
      .child(div().relative().child(Input.new(this.pathInput).h(28).px(8).rounded(6).border(1).border_color(t.input).bg(t.input).text_size(12))
        .when(!this.pathInput.value(), (el) => el.child(div().absolute().left(9).top(0).h(28).flex().items_center().text_size(12).text_color(t.dim).child("Add another: a folder in the repo, then ↵"))))
      .when(!!this.pickError, (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.pickError)));
  }
}
