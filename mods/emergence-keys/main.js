// Every Emergence shortcut in plain words, grouped, filterable by typing (as Herdr's keys dialog, ⌘/, which shows
// keys.json alone and not the keys the mods handle themselves). ⌘⇧/ or the tab bar's keyboard button. Esc closes.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, props, closeOverlay, theme, setShared } from "herdr";
import { rows, DIALOG } from "./lib.js";

export default class EmergenceKeys extends View {
  init(_props, cx) {
    setShared("emergence.over", { at: Date.now(), open: true }); // the keyboard goes back where it was when this closes
    this.filter = "";
    this.input = InputState.new({ placeholder: "Type to filter…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
  }

  async close() { setShared("emergence.over", { at: Date.now(), open: false }); }

  // A key as a raised chip; "↑ ↓ · ↵" is two.
  chips(t, k) {
    return h_flex().w(150).flex_none().gap(4).items_center().children(k.split(" · ").map((c) =>
      div().h(20).px(6).flex().items_center().rounded(4).bg(t.raised).border_1().border_color(t.input).text_size(11).text_color(t.foreground).child(c)));
  }

  render() {
    const t = theme(), close = () => closeOverlay(props().overlay);
    const groups = rows(keys(), this.filter);
    return v_flex().id("emergence-keys").on_key_down((e) => { if (e.key === "escape") close(); })
      .size_full().min_h(0).p(DIALOG.pad).gap(DIALOG.gap).rounded(DIALOG.radius).bg(t.popover).text_size(12)
      .child(h_flex().h(DIALOG.title).flex_none().items_center().justify_between()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Emergence keys"))
        .child(div().id("ek-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(close).child("Esc")))
      .child(Input.new(this.input).h(36).flex_none().px(10).rounded(8).border_1().border_color(t.input).bg(t.surface).text_size(12.8).text_color(t.foreground))
      .child(v_flex().id("ek-list").flex_1().min_h(0).overflow_y_scrollbar().gap(18)
        .when(!groups.length, (el) => el.child(div().text_color(t.dim).child("No key matches.")))
        .children(groups.map(([name, list]) => v_flex().flex_none().gap(6)
          .child(div().text_size(11.5).font_medium().text_color(t.dim).child(name))
          .child(v_flex().p(4).rounded(6).bg(t.surface).border_1().border_color(t.border)
            .children(list.map(([k, what], i) => h_flex().id(`ek-${name}-${i}`).h(28).flex_none().px(8).gap(12).rounded(4).items_center()
              .hover((s) => s.bg(t.hover))
              .child(this.chips(t, k))
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(what))))))));
  }
}
