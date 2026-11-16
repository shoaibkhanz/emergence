// Delete several worktrees at once: a 680px dialog Spaces opens (⇧← in Spaces, or "Delete worktrees…" on a
// worktree's right-click), props { items, ticked } from spaces-plus lib's sweepItems. Each row: a checkbox, the
// branch, its repo (and "open" / "archived"), and its uncommitted changes, counted here with `git status --porcelain`
// (red dot and count; "clean"). ↑/↓ move, Space or a click ticks, ↵ asks: the line under the list turns into the
// question and the buttons into Back (selected), Delete N clean and, at the far left in red, Delete permanently,
// including N with changes (←/→/Tab as confirm-safe). The plan (lib.js) goes to Spaces in shared "spaces.sweep",
// then spaces-plus.sweep removes them (it outlives this dialog): plain `git worktree remove`, --force only for the
// changed ones and only on the red choice. Never a branch. Closing gives the keyboard back (shared emergence.over).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { run, props, closeOverlay, theme, exec, setShared } from "herdr";
import { step, tick, plan, tally, question, choices, onlyHereArgs, DIALOG } from "./lib.js";

const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");

export default class WorktreeSweep extends View {
  init(_props, cx) {
    setShared("emergence.over", { at: Date.now(), open: true });
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.list = ScrollHandle.new();
    const keys = new Set((props()?.items ?? []).map((it) => it.key));
    this.ticked = new Set((props()?.ticked ?? []).filter((k) => keys.has(k)));
    this.counts = {};
    this.only = {}; // key -> commits only on its branch (the branch keeps them)
    this.cur = Math.max(0, (props()?.items ?? []).findIndex((it) => this.ticked.has(it.key))); // on the row it was opened from
    this.asking = null; // the confirm's { list, sel } while it asks
    for (const it of props()?.items ?? []) cx.spawn(async (cx) => {
      const st = await exec("git", ["-C", it.path, "status", "--porcelain"], { on: it.on }).catch(() => ({ code: 1 }));
      this.counts = { ...this.counts, [it.key]: st.code === 0 ? st.stdout.split("\n").filter(Boolean).length : null };
      cx.notify();
      const only = await exec("git", ["-C", it.path, ...onlyHereArgs(it.branch)], { on: it.on }).catch(() => ({ code: 1 }));
      if (only.code === 0) { this.only = { ...this.only, [it.key]: Number(only.stdout.trim()) }; cx.notify(); }
    });
  }

  async close() { setShared("emergence.over", { at: Date.now(), open: false }); }

  picked() {
    const items = props()?.items ?? [];
    const p = plan(items, this.ticked, this.counts, false);
    return { n: p.remove.length + p.skip.length, d: p.skip.length, c: items.filter((it) => this.ticked.has(it.key) && this.only[it.key] > 0).length };
  }

  // ↵ on the list: ask, once every ticked count is known.
  ask() {
    const { n, d } = this.picked();
    if (n && [...this.ticked].every((k) => k in this.counts)) this.asking = choices(n, d);
  }

  press(what) {
    if (what === "back") { this.asking = null; return; }
    const p = plan(props().items, this.ticked, this.counts, what === "force");
    setShared("spaces.sweep", { at: Date.now(), remove: p.remove, skip: p.skip.map((it) => it.label) });
    closeOverlay(props().overlay);
    run("spaces-plus.sweep");
  }

  key(e, cx) {
    const items = props()?.items ?? [], a = this.asking;
    if (e.key === "escape") closeOverlay(props().overlay);
    else if (a && e.key === "enter") this.press(a.list[a.sel][1]);
    else if (a && ["left", "right", "tab"].includes(e.key)) this.asking = { ...a, sel: step(a.sel, e.key, a.list.length) };
    else if (a) return;
    else if (e.key === "up" || e.key === "down") this.cur = Math.max(0, Math.min(items.length - 1, this.cur + (e.key === "up" ? -1 : 1)));
    else if ((e.key === "space" || e.key_char === " ") && items[this.cur]) this.ticked = tick(this.ticked, items[this.cur].key);
    else if (e.key === "enter") this.ask();
    else return;
    this.list.scroll_to_item(this.cur);
    cx.stop_propagation();
    cx.notify();
  }

  row(it, i, t) {
    const on = this.ticked.has(it.key), n = this.counts[it.key], cur = i === this.cur && !this.asking;
    const tag = [it.repo, it.space ? "open" : "", it.archived ? "archived" : ""].filter(Boolean).join(" · ");
    const changes = n === undefined ? div().text_color(t.dim).child("…")
      : n === 0 && this.only[it.key] > 0 ? h_flex().id(`wo-${i}`).gap(6).items_center().text_color(t.muted) // the branch keeps them
        .tooltip(`${this.only[it.key]} commit${this.only[it.key] === 1 ? "" : "s"} only on ${it.branch ?? "no branch"}: not pushed or merged.`)
        .child(div().size(6).rounded(3).bg(t.working)).child(`${this.only[it.key]} not merged`)
      : n === 0 ? div().text_color(t.dim).child("clean")
      : h_flex().gap(6).items_center().text_color(t.blocked) // the caution: Delete skips it unless forced
        .child(div().size(6).rounded(3).bg(t.blocked)).child(n === null ? "couldn't check" : `${n} change${n === 1 ? "" : "s"}`);
    return h_flex().id(`ws-${i}`).h(32).flex_none().px(10).gap(10).items_center().rounded(6).cursor_pointer()
      .when(cur, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { if (!this.asking) { this.cur = i; this.ticked = tick(this.ticked, it.key); cx.notify(); } })
      .child(h_flex().size(14).flex_none().items_center().justify_center().rounded(3).border_1()
        .map((el) => on ? el.bg(t.solid).border_color(t.solid) : el.border_color(t.input))
        .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.solid_foreground))))
      .child(div().flex_shrink(1).min_w(0).truncate().font_medium().text_color(t.foreground).child(it.label))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(tag))
      .child(div().flex_none().text_size(12).child(changes));
  }

  render() {
    const t = theme(), items = props()?.items ?? [], a = this.asking, { n, d, c } = this.picked();
    const button = (id, label, on, danger, onClick) => h_flex().id(id).h(DIALOG.button).px(14).gap(6).items_center().rounded(8).cursor_pointer()
      .border_1().text_size(12).font_medium()
      .map((el) => on && danger ? el.bg(alpha(t.blocked, 0.18)).border_color(alpha(t.blocked, 0.5)).text_color(t.blocked)
        : on ? el.bg(t.solid).border_color(t.solid).text_color(t.solid_foreground)
        : el.bg(t.raised).border_color(t.input).text_color(danger ? t.blocked : t.foreground))
      .hover((s) => s.opacity(0.88)).on_click(onClick).child(label).when(on, (el) => el.child(div().text_size(11).opacity(0.7).child("↵")));
    const ready = n > 0 && [...this.ticked].every((k) => k in this.counts);
    const buttons = a
      ? a.list.map(([label, what], i) => button(`wb${i}`, label, a.sel === i, what === "force", (_e, cx) => { this.press(what); cx.notify(); }))
      : [button("wb-cancel", "Cancel", false, false, () => closeOverlay(props().overlay)),
        button("wb-ask", n ? `Delete ${n}…` : "Delete…", ready, false, (_e, cx) => { this.ask(); cx.notify(); }).when(!ready, (el) => el.opacity(0.5))];
    const row = a?.list[0][1] === "force" ? [buttons[0], div().flex_1(), ...buttons.slice(1)] : [div().flex_1(), ...buttons];
    return v_flex().id("worktree-sweep").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(DIALOG.pad).gap(DIALOG.gap).rounded(DIALOG.radius).bg(t.popover).text_size(13)
      .child(h_flex().h(DIALOG.title).flex_none().items_center().gap(12)
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child("Delete worktrees"))
        .child(div().id("ws-esc").flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Esc")))
      .child(v_flex().flex_1().min_h(0).gap(8)
        .child(div().h(18).flex_none().text_size(12).text_color(t.muted).child("Space ticks, ↑/↓ move, ↵ deletes the ticked. Branches stay."))
        .child(v_flex().id("ws-list").flex_1().min_h(0).p(4).rounded(6).bg(t.surface).border_1().border_color(t.border)
          .overflow_y_scrollbar().track_scroll(this.list)
          .when(!items.length, (el) => el.child(div().p(8).text_color(t.dim).child("No worktrees to delete.")))
          .children(items.map((it, i) => this.row(it, i, t)))))
      .child(v_flex().flex_none().gap(10)
        .child(div().h(18).truncate().text_size(12).text_color(a && d ? t.blocked : t.muted).child(a ? question(n, d, c) : tally(items, this.ticked, this.counts, this.only)))
        .child(h_flex().gap(8).children(row)));
  }
}
