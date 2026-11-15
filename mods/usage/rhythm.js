// Usage's Rhythm tab: when you start work, agents at once, run lengths and weekdays.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { alpha } from "./charts.js";
import { levels, addDays } from "./lib.js";
import { WD, LEVEL, pct, date, mins, hh } from "./format.js";

export const rhythm = {
  rhythmTiles(t, r) {
    const x = r.rhythm, hrs = r.punch.reduce((a, row) => a.map((n, i) => n + row[i]), Array(24).fill(0)), busy = Math.max(...hrs) ? hrs.indexOf(Math.max(...hrs)) : null;
    return this.tileRow(t, [
      ["Typical run", x.medianMin == null ? "–" : mins(x.medianMin), `longest ${mins(x.longestMin)}`],
      ["Runs per active day", x.perDay.toFixed(1), `${pct(x.weekend)} on weekends`],
      ["Agents at once", `${x.typicalParallel} typical`, `peak ${x.peakParallel} on one day`],
      ["Busiest hour", busy == null ? "–" : `${String(busy).padStart(2, "0")}:00`, "most runs start then"],
    ]);
  },

  // Horizontal bars stacked down the card: a label, the bar, the count.
  bars(t, title, sub, items, w) {
    const max = Math.max(1, ...items.map(([, n]) => n)), track = Math.max(40, w - 56 - 32 - 16);
    return this.card(t, title, div().text_size(11).text_color(t.dim).child(sub), v_flex().gap(4).children(items.map(([label, n]) => h_flex().h(20).gap(8).items_center()
      .child(div().w(56).flex_none().text_size(11).text_color(t.muted).child(label))
      .child(div().w(track).h(10).rounded(3).bg(t.raised).child(div().h(10).rounded(3).w(Math.max(2, (n / max) * track)).bg(alpha(t.done, 0.85))))
      .child(div().w(32).flex_none().text_right().text_size(11).text_color(t.dim).child(String(n))))));
  },

  // Hours stacked down, weekdays across, in the calendar's own 11 px squares; under it, the day split in four.
  // Press or drag cells, an hour (its label: every day) or a weekday (its letter: every hour) to pick them.
  punch(t, r0, r) {
    const slots = this.sel?.kind === "slots", grid = (slots ? r0 : r).punch, lvl = levels(grid.flat()), x = this.hoverPunch;
    const hrs = r.punch.reduce((a, row) => a.map((n, i) => n + row[i]), Array(24).fill(0)), all = hrs.reduce((a, n) => a + n, 0) || 1;
    const parts = [["Night", 0], ["Morning", 6], ["Afternoon", 12], ["Evening", 18]].map(([label, h0]) => [label, hrs.slice(h0, h0 + 6).reduce((a, n) => a + n, 0) / all]);
    const pick = (el, at, onHover) => this.pick(el, "slots", at, onHover);
    return this.card(t, "When you start work", null, v_flex().flex_1().gap(3)
      .child(h_flex().gap(3).pl(37).children(WD.map((w, d) => pick(div().id(`punch-d-${d}`).w(11).flex_none().text_size(9).text_color(t.dim).hover((s) => s.text_color(t.foreground)).child(w[0]), [[d, d], [0, 23]]))))
      .children(Array.from({ length: 24 }, (_, h) => h_flex().gap(3).items_center()
        .child(pick(div().id(`punch-h-${h}`).w(34).flex_none().text_size(9).text_color(t.dim).hover((s) => s.text_color(t.foreground)).child(h % 3 ? "" : hh(h)), [[0, 6], [h, h]]))
        // Hours not picked keep their level in grey (as the calendar's days): faded, a quiet hour would look empty.
        .children(grid.map((row, d) => pick(div().id(`punch-${d}-${h}`).size(11).flex_none().rounded(3)
          .bg(row[h] ? alpha(slots && !this.sel.keys.has(d * 24 + h) ? t.muted : t.done, LEVEL[lvl(row[h])]) : t.raised)
          .when(x?.d === d && x?.h === h, (el) => el.border(1).border_color(t.foreground)), [[d, d], [h, h]],
          (on) => { if (on) this.hoverPunch = { d, h, n: row[h] }; else if (this.hoverPunch?.d === d && this.hoverPunch?.h === h) this.hoverPunch = null; })))))
      .child(div().h(20).pt(4).truncate().text_size(11).text_color(t.muted)
        .child(x ? `${WD[x.d]} ${hh(x.h)}: ${x.n} session${x.n === 1 ? "" : "s"}` : slots ? `${r.tiles.sessions} session${r.tiles.sessions === 1 ? "" : "s"} picked` : "drag to pick hours"))
      .child(div().flex_1())
      .child(div().h(1).my(6).bg(t.border))
      .children(parts.map(([label, share]) => h_flex().h(18).gap(6).items_center().text_size(11)
        .child(div().w(62).flex_none().text_color(t.muted).child(label))
        .child(div().w(52).h(6).rounded(3).bg(t.raised).child(div().h(6).rounded(3).w(Math.max(2, share * 52)).bg(alpha(t.done, 0.85))))
        .child(div().text_color(t.dim).child(pct(share))))));
  },

  // The busiest moment of each day (each week, past 120 days, so bars never overflow): how many agents ran at once.
  parallel(t, r0, r) {
    const daily = (this.sel?.kind === "days" ? r0 : r).rhythm.daily, step = daily.length > 120 ? 7 : 1;
    const bins = [];
    for (let i = 0; i < daily.length; i += step) bins.push({ t: daily[i].t, n: Math.max(...daily.slice(i, i + step).map((d) => d.n)) });
    const max = Math.max(1, ...bins.map((d) => d.n)), x = bins.find((d) => d.t === this.hoverPeak);
    return this.card(t, "Agents at once", div().text_size(11).text_color(t.dim).child(`peak ${r.rhythm.peakParallel} · typical ${r.rhythm.typicalParallel} on active days`), v_flex().gap(6)
      .child(h_flex().h(56).gap(1).items_end().overflow_hidden().children(bins.map((d) => {
        const at = [d.t, step === 7 ? Math.min(addDays(d.t, 6), this.last) : d.t];
        return this.pick(div().id(`peak-${d.t}`).flex_1().min_w(0).h(56).flex().items_end().when(!this.lit(at), (el) => el.opacity(0.3)), "days", at,
          (on) => { if (on) this.hoverPeak = d.t; else if (this.hoverPeak === d.t) this.hoverPeak = null; })
          .child(div().w_full().rounded(2).h(d.n ? Math.max(3, (d.n / max) * 56) : 2).bg(d.n ? alpha(t.accent, this.hoverPeak === d.t ? 1 : 0.75) : t.raised));
      })))
      .child(h_flex().justify_between().text_size(11).text_color(t.dim)
        .child(date(bins[0]?.t ?? Date.now()))
        .child(div().text_color(t.muted).child(x ? `${step === 7 ? "Week of" : WD[(new Date(x.t).getDay() + 6) % 7]} ${date(x.t)}: ${x.n} at once` : "press or drag to pick days"))
        .child(date(bins.at(-1)?.t ?? Date.now()))));
  },
};
