// Usage's building blocks, used by every tab: icons, segmented controls, cards, tiles, layout.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { HARNESS, MIX } from "./format.js";

export const widgets = {
  icon(t, h, size) {
    const x = HARNESS[h];
    return x.tint ? svg(x.icon).size(size).flex_none().text_color(t.foreground) : image(x.icon).w(size).h(size).flex_none().rounded(4);
  },

  segmented(t, id, options, on, pick) {
    return h_flex().h(24).p(2).gap(2).flex_none().items_center().rounded(7).bg(t.raised).children(options.map(([v, label]) =>
      div().id(`${id}-${v}`).h(20).px(8).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .text_color(v === on ? t.foreground : t.muted).when(v === on, (el) => el.bg(t.background))
        .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { pick(v); cx.notify(); }).child(label)));
  },

  card(t, title, right, body) {
    return v_flex().flex_none().p(14).gap(12).rounded(10).border(1).border_color(t.border).bg(t.surface)
      .child(h_flex().h(24).gap(8).items_center().child(div().flex_1().text_size(13).font_semibold().child(title)).when(Boolean(right), (el) => el.child(right)))
      .child(body);
  },

  // Four headline tiles: [label, value, sub] each; one row where there's room, two otherwise.
  tileRow(t, specs) {
    const tile = ([label, value, sub]) => v_flex().flex_1().min_w(0).p(12).gap(4).rounded(10).border(1).border_color(t.border).bg(t.surface)
      .child(div().text_size(11).text_color(t.dim).child(label)).child(div().text_size(15).font_semibold().child(value)).child(div().truncate().text_size(11).text_color(t.dim).child(sub));
    const cols = this.width >= 640 ? 4 : 2;
    return v_flex().flex_none().gap(8).children(Array.from({ length: specs.length / cols }, (_, i) => h_flex().gap(8).children(specs.slice(i * cols, i * cols + cols).map(tile))));
  },

  // Two cards side by side where there's room, stacked where there isn't; `w` is one card's inner width.
  pair(a, b) {
    // side by side, both as tall as the taller, so their bottoms line up instead of one leaving a hole
    return this.width >= 700 ? h_flex().gap(12).items_stretch().child(v_flex().flex_1().min_w(0).child(a.flex_1())).child(v_flex().flex_1().min_w(0).child(b.flex_1())) : v_flex().gap(12).child(a).child(b);
  },
  innerW() {
    return (this.width >= 700 ? (this.width - 32 - 12) / 2 : this.width - 32) - 30;
  },

  // A 100% bar of the token kinds, with a gap between parts.
  stack(t, m, w, h = 14) {
    const tot = MIX.reduce((a, [k]) => a + (m[k] ?? 0), 0) || 1;
    return h_flex().w(w).h(h).gap(1).rounded(4).overflow_hidden().bg(t.raised)
      .children(MIX.filter(([k]) => m[k]).map(([k, , ink]) => div().h(h).w(Math.max(2, (m[k] / tot) * w - 1)).bg(ink)));
  },
};
