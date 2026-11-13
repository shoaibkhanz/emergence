// Herdr's confirm dialog (mods/confirm), but Cancel is selected when it opens: Enter alone cancels, so a destructive
// action takes a deliberate → (or Tab) then Enter, or a click on Confirm. Esc cancels.
// Props, as confirm's: { title, detail, command: { name, args } }.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";

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
  }

  key(e, cx) {
    if (e.key === "escape") this.done(false);
    else if (e.key === "enter") this.done(this.yes);
    else if (["left", "right", "tab"].includes(e.key)) { this.yes = e.key === "tab" ? !this.yes : e.key === "right"; cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme(), p = props() ?? {};
    const button = (id, label, on, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().cursor_pointer()
      .border_color(on ? t.solid : t.input).bg(on ? t.solid : t.raised).text_color(on ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
    return v_flex().id("confirm-safe").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(18).gap(12).rounded(8).bg(t.popover).text_size(13)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(p.title ?? "Are you sure?"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_1().min_h(0).overflow_y_scrollbar().text_color(t.muted).child(p.detail ?? ""))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("no", "Cancel", !this.yes, () => this.done(false)))
        .child(button("yes", "Confirm", this.yes, () => this.done(true))));
  }
}
