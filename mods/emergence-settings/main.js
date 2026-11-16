// Emergence settings: every switch the mods keep, grouped by mod, written the moment it flips (as Herdr's own
// Settings, no Save). ⌘⌥, or the tab bar's sliders button. ↑/↓ move, ↵ or space flips, Esc closes. lib.js decides.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, knownAgents } from "herdr";
import { sections, toggles } from "./lib.js";

export default class EmergenceSettings extends View {
  init(_props, cx) {
    setShared("emergence.over", { at: Date.now(), open: true }); // the keyboard goes back where it was when this closes
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.cursor = null; // a row id, once ↑/↓ is pressed
    this.known = null;
    cx.spawn(async (cx) => {
      this.known = Object.fromEntries((await knownAgents().catch(() => [])).map((a) => [a.key, a.installed]));
      cx.notify();
    });
  }

  async close() { setShared("emergence.over", { at: Date.now(), open: false }); }

  key(e, list, cx) {
    const i = list.findIndex((r) => r.id === this.cursor);
    if (e.key === "escape") return closeOverlay(props().overlay);
    if (e.key === "down" || e.key === "up") {
      const step = e.key === "down" ? 1 : -1, at = i < 0 ? (step > 0 ? 0 : list.length - 1) : i + step;
      this.cursor = list[Math.max(0, Math.min(list.length - 1, at))]?.id ?? null;
    } else if ((e.key === "enter" || e.key === "space") && i >= 0) this.flip(list[i]);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  flip(r) { for (const [k, v] of r.writes) setShared(k, v); }

  // Herdr's Settings switch (frame/settings toggle): accent when on.
  toggle(t, r) {
    return div().id(`es-t-${r.id}`).w(36).h(20).rounded(10).p(2).flex().cursor_pointer().bg(r.on ? t.accent : t.hover)
      .when(r.on, (el) => el.justify_end()).on_click(() => { this.cursor = r.id; this.flip(r); })
      .child(div().w(16).h(16).rounded(8).bg(r.on ? t.accent_foreground : t.muted));
  }

  row(t, r) {
    return h_flex().id(`es-${r.id}`).w_full().gap(16).px(10).py(10).items_center().rounded(8).border_1()
      .border_color(r.id === this.cursor ? t.accent : "#00000000")
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(13).font_medium().text_color(r.writes ? t.foreground : t.dim).child(r.name))
        .when(Boolean(r.about), (el) => el.child(div().text_size(12).text_color(t.muted).child(r.about))))
      .child(r.writes ? this.toggle(t, r) : div().text_size(12).text_color(t.dim).child(r.note));
  }

  render(cx) {
    const t = theme(), secs = sections(shared, this.known), list = toggles(secs);
    return v_flex().id("emergence-settings").track_focus(this.handle).on_key_down((e, cx) => this.key(e, list, cx))
      .size_full().min_h(0).p(24).gap(16).bg(t.popover).text_size(13)
      .child(h_flex().h(22).flex_none().items_center().justify_between()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Emergence settings"))
        .child(div().id("es-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Esc")))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(14)
        .children(secs.map((s) => v_flex().gap(2)
          .child(div().px(10).text_size(11.5).font_medium().text_color(t.dim).child(s.title))
          .when(Boolean(s.about), (el) => el.child(div().px(10).pb(2).text_size(12).text_color(t.muted).child(s.about)))
          .children(s.rows.length ? s.rows.map((r) => this.row(t, r))
            : [div().px(10).py(8).text_size(12).text_color(t.dim).child(s.empty)]))));
  }
}
