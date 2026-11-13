// A context menu with the items its opener passes, drawn as Herdr's menu mod (whose items are fixed).
// Opened as a popup with props { items: [[label, command, args, icon, hint], …] }; a label starting with "—" is a
// divider above the next item. ↑/↓ move, Enter runs, Esc closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";

export default class RowMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  items() {
    return (props()?.items ?? []).filter((it) => !it[0].startsWith("—"));
  }

  choose(i) {
    const it = this.items()[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    run(it[1], it[2] ?? {});
  }

  render() {
    const t = theme(), list = this.items(), split = new Set();
    (props()?.items ?? []).reduce((n, it) => (it[0].startsWith("—") ? (split.add(n), n) : n + 1), 0);
    return v_flex().id("row-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map(([label, , , icon, hint], i) => v_flex()
        .when(split.has(i), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`rm-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(i))
          .child(svg(icon ?? "mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(label))
          .child(div().text_size(11).text_color(t.dim).child(hint ?? "")))));
  }
}
