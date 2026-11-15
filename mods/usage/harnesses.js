// Usage's Harnesses tab: tokens over time by harness (Overview's day by day too), models and effort.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { areas, alpha } from "./charts.js";
import { addDays, DAY } from "./lib.js";
import { HARNESS, EFFORT, EFFORT_INK, WD, short, pct, date } from "./format.js";

export const harnesses = {
  // Stacked bars per day (weeks past a month) by harness, of one bucket field: tokens (by) for Harnesses; sessions,
  // cost or commits for Overview's day by day.
  over(t, r0, r, present, { field = "by", fmt = short, title = "Tokens by harness", right = null } = {}) {
    const days = this.sel?.kind === "days", src = days ? r0 : r;
    const max = Math.max(1e-9, ...src.buckets.map((b) => Object.values(b[field]).reduce((a, n) => a + n, 0)));
    // Smooth stacked areas (charts.js), one point per bucket edge to edge. Over them, a hit column per bucket centred
    // on its point: hovering draws a guide and a dot per harness, pressing or dragging picks, picked days are a band.
    const H = 150, W = this.width - 32 - 30, unit = src.step === DAY ? "Day" : "Week of", n = src.buckets.length;
    const X = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2), half = n > 1 ? W / (n - 1) / 2 : W / 2;
    const colors = Object.fromEntries(present.map((h) => [h, HARNESS[h].color]));
    const hi = src.buckets.findIndex((b) => b.t === this.hoverBar);
    let cum = 0;
    const dots = hi < 0 ? [] : present.filter((h) => src.buckets[hi][field][h]).map((h) => {
      cum += src.buckets[hi][field][h];
      return div().absolute().left(X(hi) - 4).top(H - (cum / max) * (H - 2) - 4).size(8).rounded_full().bg(colors[h]).border(2).border_color(t.surface);
    });
    const bars = div().relative().w(W).h(H)
      // smooth curves (the person's pick over straight segments); hovering shows each day's values
      .children(areas(t, { w: W, h: H, buckets: src.buckets, field, order: present, colors, max }))
      .children([1, 0.5].map((f) => div().absolute().right(0).top(H - f * (H - 2) - 15).text_size(10).text_color(t.dim).child(fmt(max * f))))
      .when(hi >= 0, (el) => el.child(div().absolute().left(X(hi)).top(0).w(1).h(H).bg(alpha(t.foreground, 0.3))).children(dots))
      .children(src.buckets.map((b, i) => {
        const at = [b.t, src.step === DAY ? b.t : Math.min(addDays(b.t, 6), this.last)], x0 = Math.max(0, X(i) - half);
        return this.pick(div().id(`bar-${b.t}`).absolute().left(x0).top(0).w(Math.min(W, X(i) + half) - x0).h(H)
          .when(days && this.lit(at), (el) => el.bg(alpha(t.accent, 0.1))), "days", at,
          (on) => { if (on) this.hoverBar = b.t; else if (this.hoverBar === b.t) this.hoverBar = null; });
      }));
    const dayName = (ms) => `${WD[(new Date(ms).getDay() + 6) % 7]} ${date(ms)}`;
    // labels under their points: every day up to two weeks, else the first, the last and one a week between
    const shown = (i) => n <= 14 || i === 0 || i === n - 1 || (i % 7 === 0 && n - 1 - i >= 4);
    const axis = n > 1 && n <= 31 && src.step === DAY
      ? div().relative().w(W).h(16).text_size(11).text_color(t.dim).children(src.buckets.map((b, i) => [b, i]).filter(([, i]) => shown(i)).map(([b, i]) =>
        div().absolute().top(0).left(Math.max(0, Math.min(W - 60, X(i) - 30))).w(60).when(i === 0, (el) => el.text_left()).when(i === n - 1, (el) => el.text_right())
          .when(i > 0 && i < n - 1, (el) => el.text_center()).text_color(i === hi ? t.foreground : t.dim).child(n <= 14 ? dayName(b.t) : date(b.t))))
      : h_flex().justify_between().text_size(11).text_color(t.dim)
        .child(date(src.buckets[0]?.t ?? Date.now())).child(date(src.buckets.at(-1)?.t ?? Date.now()));
    // The legend shows the hovered bar's split, else what's picked, else the period's.
    const hb = src.buckets.find((b) => b.t === this.hoverBar);
    const totals = hb ? hb[field] : Object.fromEntries(present.map((h) => [h, r.buckets.reduce((a, b) => a + (b[field][h] ?? 0), 0)]));
    const legend = h_flex().h(20).gap(12).items_center().child(div().text_size(12).font_semibold().child(hb ? (src.step === DAY ? dayName(hb.t) : `${unit} ${date(hb.t)}`) : this.sel ? this.selLabel() : "All"))
      .children(present.filter((h) => totals[h]).map((h) => h_flex().gap(6).items_center().text_size(12)
        .child(div().size(8).rounded(2).bg(HARNESS[h].color)).child(HARNESS[h].name).child(div().text_size(11).text_color(t.dim).child(fmt(totals[h])))));
    return this.card(t, title, right ?? div().text_size(11).text_color(t.dim).child("hover a bar for its split · press or drag to pick"), v_flex().gap(8).child(bars).child(axis).child(legend));
  },

  models(t, r) {
    const track = Math.max(60, this.width - 32 - 28 - 190 - 96 - 16), top = r.models[0]?.share || 1;
    return this.card(t, "Models", div().text_size(11).text_color(t.dim).child("by tokens"), v_flex().gap(6).children(r.models.map((m) => h_flex().id(`model-${m.model}`).h(22).gap(8).items_center()
      .tooltip(Object.entries(m.by).map(([h, n]) => `${HARNESS[h]?.name ?? h} ${short(n)}`).join(" · "))
      .child(h_flex().w(190).gap(6).items_center().child(this.icon(t, m.h, 14)).child(div().min_w(0).truncate().text_size(12).child(m.model)))
      .child(div().w(track).h(6).rounded(3).bg(t.raised).child(div().h(6).rounded(3).w(Math.max(2, (m.share / top) * track)).bg(HARNESS[m.h].color)))
      .child(div().w(96).text_size(11).text_color(t.dim).child(`${short(m.tokens)} · ${pct(m.share)}`)))));
  },

  effort(t, r, present) {
    const track = Math.max(60, this.width - 32 - 28 - 140 - 56 - 16);
    const used = EFFORT.filter((l) => present.some((h) => r.effort[h]?.[l]));
    const rows = present.filter((h) => r.effort[h]).map((h) => {
      const e = r.effort[h], n = Object.values(e).reduce((a, x) => a + x, 0);
      return h_flex().h(24).gap(8).items_center()
        .child(h_flex().w(140).gap(6).items_center().child(this.icon(t, h, 14)).child(div().truncate().text_size(12).child(HARNESS[h].name)))
        .child(h_flex().w(track).h(14).gap(1).rounded(4).overflow_hidden().bg(t.raised).children(EFFORT.filter((l) => e[l]).map((l) =>
          div().id(`effort-${h}-${l}`).h(14).w(Math.max(2, (e[l] / n) * track - 1)).bg(EFFORT_INK[l])
            .on_hover((on, cx) => { if (on) this.hoverEffort = { h, l }; else if (this.hoverEffort?.h === h && this.hoverEffort?.l === l) this.hoverEffort = null; cx.notify(); }))))
        .child(div().w(56).text_size(11).text_color(t.dim).child(`${n} runs`));
    });
    const x = this.hoverEffort;
    const legend = h_flex().gap(12).items_center().children(used.map((l) => h_flex().gap(5).items_center().text_size(11).text_color(t.muted)
      .child(div().size(10).rounded(2).bg(EFFORT_INK[l])).child(l === "default" ? "not recorded" : l)));
    return this.card(t, "Effort", div().text_size(11).text_color(t.dim).child("share of runs per effort level"), v_flex().gap(8)
      .children(rows).child(legend)
      .child(div().h(16).text_size(12).text_color(t.muted).child((() => {
        const e = x && r.effort[x.h], k = e?.[x.l], n = e ? Object.values(e).reduce((a, v) => a + v, 0) : 0;
        return k ? `${HARNESS[x.h].name} · ${x.l === "default" ? "effort not recorded" : x.l}: ${k} of ${n} runs (${pct(k / n)})` : "";
      })())));
  },
};
