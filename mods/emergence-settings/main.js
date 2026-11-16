// Emergence settings: every switch the mods keep, grouped by mod, written the moment it changes (as Herdr's own
// Settings, no Save). ⌘⌥, or the tab bar's sliders button. ↑/↓ move, ↵ or space flips (a choice goes round), ←/→
// step a choice, Esc closes. lib.js decides. Each section's rows sit in one boxed card (RECIPE "Dialogs").

import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, knownAgents } from "herdr";
import { sections, toggles, choose, DIALOG } from "./lib.js";

const ROW = 36, ROW_ABOUT = 52; // a row with only its name; with its one-line about under it

export default class EmergenceSettings extends View {
  init(_props, cx) {
    setShared("emergence.over", { at: Date.now(), open: true }); // the keyboard goes back where it was when this closes
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    this.cursor = null; // a row id; the first row until ↑/↓ moves it
    this.known = null;
    cx.spawn(async (cx) => {
      this.known = Object.fromEntries((await knownAgents().catch(() => [])).map((a) => [a.key, a.installed]));
      cx.notify();
    });
  }

  async close() { setShared("emergence.over", { at: Date.now(), open: false }); }

  key(e, secs, list, cx) {
    const i = list.findIndex((r) => r.id === this.cursor), r = list[i];
    if (e.key === "escape") return closeOverlay(props().overlay);
    if (e.key === "down" || e.key === "up") this.cursor = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "down" ? 1 : -1)))]?.id ?? null;
    else if ((e.key === "left" || e.key === "right") && r?.options) this.apply(choose(r, e.key === "left" ? -1 : 1));
    else if ((e.key === "enter" || e.key === "space" || e.key_char === " ") && r) this.apply(choose(r, 0));
    else return;
    const at = secs.findIndex((s) => s.rows.some((x) => x.id === this.cursor));
    if (at >= 0) this.scroll.scroll_to_item(at);
    cx.stop_propagation();
    cx.notify();
  }

  apply(writes) { for (const [k, v] of writes) setShared(k, v); }

  // Herdr's Settings switch: accent when on; off, a raised track with the input border.
  toggle(t, r) {
    return div().id(`es-t-${r.id}`).w(36).h(20).rounded(10).p(2).flex().flex_none().cursor_pointer().border_1()
      .map((el) => r.on ? el.bg(t.accent).border_color(t.accent).justify_end() : el.bg(t.raised).border_color(t.input))
      .on_click((_e, cx) => { this.cursor = r.id; this.apply(r.writes); cx.notify(); })
      .child(div().w(14).h(14).rounded(7).bg(r.on ? t.accent_foreground : t.muted));
  }

  // A choice: segments as the Agents panel's Active | All, the chosen one lifted.
  choice(t, r) {
    return h_flex().flex_none().p(2).gap(2).rounded(6).bg(t.raised).border_1().border_color(t.input)
      .children(r.options.map((o) => div().id(`es-c-${r.id}-${o.value}`).h(22).px(10).flex().items_center().rounded(4).text_size(12)
        .cursor_pointer().map((el) => o.value === r.value ? el.bg(t.background).text_color(t.foreground) : el.text_color(t.muted))
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.cursor = r.id; this.apply(o.writes); cx.notify(); }).child(o.label)));
  }

  row(t, r, first) {
    const acts = r.writes || r.options;
    return h_flex().id(`es-${r.id}`).w_full().h(r.about ? ROW_ABOUT : ROW).flex_none().px(12).gap(16).items_center()
      .when(!first, (el) => el.border_t_1().border_color(t.border)).when(r.id === this.cursor, (el) => el.bg(t.hover))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(13).font_medium().text_color(acts ? t.foreground : t.dim).child(r.name))
        .when(Boolean(r.about), (el) => el.child(div().id(`es-a-${r.id}`).truncate().text_size(12).text_color(t.muted).tooltip(r.about).child(r.about))))
      .child(r.options ? this.choice(t, r) : r.writes ? this.toggle(t, r) : div().flex_none().text_size(11).text_color(t.dim).child(r.note));
  }

  section(t, s) {
    return v_flex().flex_none().gap(6)
      .child(div().text_size(11.5).font_medium().text_color(t.dim).child(s.title))
      .when(Boolean(s.about), (el) => el.child(div().text_size(12).text_color(t.muted).child(s.about)))
      .child(v_flex().rounded(6).bg(t.surface).border_1().border_color(t.border).overflow_hidden()
        .children(s.rows.length ? s.rows.map((r, i) => this.row(t, r, i === 0))
          : [div().px(12).py(10).text_size(12).text_color(t.dim).child(s.empty)]));
  }

  render() {
    const t = theme(), secs = sections(shared, this.known), list = toggles(secs);
    if (!list.some((r) => r.id === this.cursor)) this.cursor = list[0]?.id ?? null;
    return v_flex().id("emergence-settings").track_focus(this.handle).on_key_down((e, cx) => this.key(e, secs, list, cx))
      .size_full().min_h(0).p(DIALOG.pad).gap(DIALOG.gap).rounded(DIALOG.radius).bg(t.popover).text_size(13)
      .child(h_flex().h(DIALOG.title).flex_none().items_center().justify_between()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Emergence settings"))
        .child(div().id("es-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Esc")))
      .child(v_flex().id("es-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).gap(18)
        .children(secs.map((s) => this.section(t, s))))
      .child(div().h(18).flex_none().truncate().text_size(12).text_color(t.muted).child(`↑/↓ move · ↵ flips${list.some((r) => r.options) ? " · ←/→ choose" : ""} · saved as you change it`));
  }
}
