// Herdr's confirm dialog (mods/confirm), but Cancel is selected when it opens: Enter alone cancels, so a destructive
// action takes a deliberate → (or Tab) then Enter, or a click on its button. Esc cancels.
// Props: { title, detail, command: { name, args } } as confirm's, plus
//   name, path: what it acts on (a branch) and where, in a mono box (the path with home as ~, shortened in the middle);
//   action: the button's verb ("Delete"); danger: draw it in the blocked colour;
//   warn (optional): a second consequence, on its own line with an amber dot;
//   extra (optional): { action, warn, command }, a destructive third choice: a red button at the far left, reached by
//   ← from Cancel (Tab wraps to it too), never selected when the dialog opens; its warn is a red line under the box.
// Every close (Confirm, Cancel, Esc) gives the keyboard back to where it was (shared emergence.over).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, props, closeOverlay, theme, home, setShared } from "herdr";
import { shortPath, step } from "./lib.js";

// Emergence's dialog standard (RECIPE "Dialogs"): 24px padding, 16px gaps, a 22px title row with the Esc chip, 32px
// buttons of which only the one Enter presses is filled; widths 440 / 560 / 680. Type is Herdr's (no font set).

const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");

export default class ConfirmSafe extends View {
  init(_props, cx) {
    setShared("emergence.over", { at: Date.now(), open: true }); // the keyboard goes back where it was when this closes
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.sel = props()?.extra ? 1 : 0; // the selected button, of [extra?, Cancel, action]: Cancel
  }

  // `command`: what the pressed button runs (none: Cancel).
  done(command) {
    closeOverlay(props().overlay);
    if (command) run(command.name, command.args ?? {});
  }

  // The buttons left to right: [label, command (null: Cancel), red].
  buttons(p) {
    return [...(p.extra ? [[p.extra.action, p.extra.command, true]] : []), ["Cancel", null, false], [p.action, p.command, !!p.danger]];
  }

  // Herdr closes a dialog on Esc itself (and on a click outside), past key(): this still runs.
  async close() { setShared("emergence.over", { at: Date.now(), open: false }); }

  key(e, cx) {
    const bs = this.buttons(props());
    if (e.key === "escape") this.done(null);
    else if (e.key === "enter") this.done(bs[this.sel]?.[1]);
    else if (["left", "right", "tab"].includes(e.key)) { this.sel = step(this.sel, e.key, bs.length); cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme(), p = { title: "", detail: "", name: "", path: "", action: "", ...props() }; // empty: herdr-app check
    // RECIPE "Dialogs": only the selected button, the one Enter presses, is filled (solid; a destructive one in blocked), with ↵.
    const button = (id, label, on, danger, onClick) => h_flex().id(id).h(32).px(14).gap(6).items_center().rounded(8).cursor_pointer()
      .border_1().text_size(12).font_medium()
      .map((el) => on && danger ? el.bg(alpha(t.blocked, 0.18)).border_color(alpha(t.blocked, 0.5)).text_color(t.blocked)
        : on ? el.bg(t.solid).border_color(t.solid).text_color(t.solid_foreground)
        : el.bg(t.raised).border_color(t.input).text_color(danger ? t.blocked : t.foreground))
      .hover((s) => s.opacity(0.88)).on_click(onClick).child(label).when(on, (el) => el.child(div().text_size(11).opacity(0.7).child("↵")));
    const bs = this.buttons(p).map(([label, command, red], i) => button(`b${i}`, label, this.sel === i, red, () => this.done(command)));
    const row = [p.extra ? bs[0] : null, div().flex_1(), ...bs.slice(p.extra ? 1 : 0)].filter(Boolean); // the extra stands apart, at the left
    return v_flex().id("confirm-safe").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(24).gap(16).rounded(10).bg(t.popover).text_size(13)
      .child(h_flex().h(22).flex_none().items_center().gap(12)
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(p.title))
        .child(div().id("cs-esc").flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.done(null)).child("Esc")))
      .child(v_flex().flex_1().min_h(0).gap(10)
        .child(div().text_color(t.muted).child(p.detail))
        .child(v_flex().id("cs-what").px(12).py(8).gap(2).rounded(6).bg(t.surface).border_1().border_color(t.border)
          .tooltip(`${p.name}\n${p.path}`)
          .child(div().truncate().font_medium().text_color(t.foreground).child(p.name))
          .child(div().truncate().text_size(12).text_color(t.dim).child(shortPath(p.path, home()))))
        .when(Boolean(p.warn), (el) => el.child(h_flex().gap(8).items_center().text_color(t.muted)
          .child(div().size(6).flex_none().rounded(3).bg(t.working)).child(div().flex_1().min_w(0).child(p.warn))))
        .when(Boolean(p.extra?.warn), (el) => el.child(h_flex().gap(8).items_center().text_color(t.blocked)
          .child(div().size(6).flex_none().rounded(3).bg(t.blocked)).child(div().flex_1().min_w(0).child(p.extra?.warn ?? "")))))
      .child(h_flex().gap(8).children(row));
  }
}
