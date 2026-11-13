// Herdr's confirm dialog (mods/confirm), but Cancel is selected when it opens: Enter alone cancels, so a destructive
// action takes a deliberate → (or Tab) then Enter, or a click on its button. Esc cancels.
// Props: { title, detail, command: { name, args } } as confirm's, plus
//   name, path: what it acts on (a branch) and where, in a mono box (the path with home as ~, shortened in the middle);
//   action: the button's verb ("Delete"); danger: draw it in the blocked colour;
//   warn (optional): a second consequence, on its own line with an amber dot;
//   after (optional): a command run on every close, Confirm or Cancel (the opener taking the keyboard back).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, props, closeOverlay, theme, home } from "herdr";
import { shortPath } from "./lib.js";

const MONO = "Geist Mono";

const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");

export default class ConfirmSafe extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.yes = false; // the selected button: Cancel
  }

  done(yes) {
    const p = props();
    closeOverlay(p.overlay);
    if (yes) run(p.command.name, p.command.args ?? {});
    if (p.after) run(p.after.name);
  }

  key(e, cx) {
    if (e.key === "escape") this.done(false);
    else if (e.key === "enter") this.done(this.yes);
    else if (["left", "right", "tab"].includes(e.key)) { this.yes = e.key === "tab" ? !this.yes : e.key === "right"; cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme(), p = { title: "", detail: "", name: "", path: "", action: "", ...props() }; // empty: herdr-app check
    // The selected button has the focus ring; the action keeps its colour either way.
    const button = (id, label, on, ink, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8).cursor_pointer()
      .border_1().border_color(on ? t.accent : ink ? alpha(ink, 0.4) : t.input).bg(ink ? alpha(ink, on ? 0.2 : 0.1) : on ? t.selected : t.raised)
      .text_color(ink ?? t.foreground).font_medium().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    return v_flex().id("confirm-safe").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(20).gap(14).rounded(10).bg(t.popover).text_size(13)
      .child(h_flex().items_center().gap(12)
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(p.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().flex_1().min_h(0).gap(10)
        .child(div().text_color(t.muted).child(p.detail))
        .child(v_flex().id("cs-what").px(10).py(7).gap(3).rounded(6).bg(t.surface).border_1().border_color(t.border).font_family(MONO)
          .tooltip(`${p.name}\n${p.path}`)
          .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(p.name))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(shortPath(p.path, home()))))
        .when(Boolean(p.warn), (el) => el.child(h_flex().gap(8).items_center().text_color(t.muted)
          .child(div().size(6).flex_none().rounded(3).bg(t.working)).child(div().flex_1().min_w(0).child(p.warn)))))
      .child(h_flex().justify_end().gap(8).text_size(12.5)
        .child(button("no", "Cancel", !this.yes, null, () => this.done(false)))
        .child(button("yes", p.action, this.yes, p.danger ? t.blocked : null, () => this.done(true))));
  }
}
