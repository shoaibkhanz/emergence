// A context menu with the items its opener passes, drawn as Herdr's menu mod (whose items are fixed).
// Opened as a popup with props { items: [[label, command, args, icon, hint, split, stays], …] }; split draws a divider
// above that item. ↑/↓ move, Enter runs, Esc closes. Closing gives the keyboard back to where it was (shared
// emergence.over), unless an item was chosen that isn't `stays` (it opens something of its own).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, setShared } from "herdr";

export default class RowMenu extends View {
  init(_props, cx) {
    setShared("emergence.over", { at: Date.now(), open: true });
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const it = props()?.items?.[i];
    if (!it) return;
    this.went = !it[6];
    closeOverlay(props()?.overlay);
    run(it[1], it[2] ?? {});
  }

  async close() { setShared("emergence.over", { at: Date.now(), open: false, went: this.went }); }

  render() {
    const t = theme(), list = props()?.items ?? [];
    return v_flex().id("row-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map(([label, , , icon, hint, split], i) => v_flex()
        .when(Boolean(split), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`rm-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(i))
          .child(svg(icon).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(label))
          .child(div().text_size(11).text_color(t.dim).child(hint ?? "")))));
  }
}
