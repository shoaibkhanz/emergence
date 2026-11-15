// Usage's Overview tab: headline tiles, the calendar, and where the spend, work and tokens went.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { alpha } from "./charts.js";
import { DAY, KINDS } from "./lib.js";
import { HARNESS, ORDER, MONTH, WD, LEVEL, MIX, short, pct, date, iso, usd } from "./format.js";

export const overview = {
  tiles(t, r) {
    // Against the period before only when the history covers it (a young history makes +5000%; lib summarize).
    const vsBefore = (a, b) => `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}% vs before`;
    const x = r.tiles, before = x.before && x.prev > 0, n = this.sel?.kind === "days" ? this.sel.keys.size : 0;
    return this.tileRow(t, [
      ["Sessions", String(x.sessions), n ? `on ${n} picked day${n === 1 ? "" : "s"}` : !before ? (x.before ? "none in the period before" : "your history starts in this period") : vsBefore(x.sessions, x.prev)],
      ["Cost", x.costKnown ? usd(x.cost) : "–", !x.costKnown ? "no cost recorded" : `${usd(x.cost / x.days)} / day${n || !before || !x.costPrev ? "" : ` · ${vsBefore(x.cost, x.costPrev)}`}`],
      // The `git commit`s agents ran, by session start (Output counts your git log by commit date).
      ["Agent commits", String(x.commits), x.perCommit == null ? "made by your agents" : `${usd(x.perCommit)} per commit`],
      ["Clean runs", pct(x.clean), n || !before || x.cleanPrev == null || x.clean == null ? "no abort, API error or compaction"
        : `${x.clean >= x.cleanPrev ? "+" : ""}${Math.round((x.clean - x.cleanPrev) * 100)} pts on the period before`],
    ]);
  },

  // The calendar always shows the last weeks for context; days outside the period are grey and can't be picked.
  heatmap(t, cells, weeks, p, x) {
    // Cells fill the card's width (11px at least, 18 at most): the weeks shown are as many as fit at 11, up to 53.
    const cs = Math.max(11, Math.min(18, Math.floor((this.width - 32 - 28 - 31 - 12) / weeks) - 3));
    const active = x && !this.sel ? `${x.activeDays} of ${x.days} days active${x.streak ? ` · ${x.streak}-day streak` : ""}` : null;
    const cols = [];
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
    const ink = t.done;
    const grid = h_flex().gap(3).items_start().overflow_hidden()
      .child(v_flex().w(28).flex_none().gap(3).pt(17).children(WD.map((w, i) => div().h(cs).flex().items_center().text_size(9).text_color(t.dim).child(i % 2 ? "" : w))))
      .children(cols.map((col, ci) => {
        const first = new Date(col[0].t), prev = ci ? new Date(cols[ci - 1][0].t) : null;
        return v_flex().w(cs).flex_none().gap(3)
          .child(div().w(cs).h(14).text_size(9).text_color(t.dim).whitespace_nowrap().child(prev && prev.getMonth() !== first.getMonth() ? MONTH[first.getMonth()] : ""))
          .children(col.map((d) => {
            // Outside the period (or not picked) a day keeps its level in grey: fading it would make a quiet day look
            // empty, since colour is all a cell has.
            const inPeriod = d.t >= p.from && d.t < p.to, custom = this.range === "custom", on = inPeriod && this.lit([d.t, d.t]);
            const cell = div().id(`heat-${d.t}`).size(cs).rounded(3).bg(d.level ? alpha(on ? ink : t.muted, LEVEL[d.level]) : t.raised)
              .when(custom || inPeriod, (el) => el.cursor_pointer())
              .when(custom && inPeriod, (el) => el.border(1).border_color(alpha(t.accent, 0.8)))
              .on_hover((on, cx) => { if (on) { this.hoverDay = d.t; this.dragTo("days", [d.t, d.t]); } else if (this.hoverDay === d.t) this.hoverDay = null; cx.notify(); });
            // Custom period: the first click starts it, the second ends it (either order). Otherwise days are picked.
            if (!custom && !inPeriod) return cell;
            return !custom ? cell.on_mouse_down("left", (e, cx) => { this.press("days", [d.t, d.t], e, cx); cx.notify(); })
              : cell.on_click((_e, cx) => {
                this.setCustom(this.picking ? { from: this.custom.from, to: d.t } : { from: d.t, to: d.t });
                this.picking = !this.picking;
                this.setSel(null);
                this.fromInput.set_value(iso(this.custom.from));
                this.toInput.set_value(iso(this.custom.to));
                cx.notify();
              });
          }));
      }));
    // The day under the pointer, else the picked days added up, else the period's (with its busiest day): by harness.
    const total = (xs) => xs.reduce((a, c) => ({ ...a, sessions: a.sessions + c.sessions, tokens: a.tokens + c.tokens, cost: a.cost + c.cost,
      by: Object.fromEntries(ORDER.map((h) => [h, (a.by[h] ?? 0) + (c.by[h] ?? 0)])) }), { sessions: 0, tokens: 0, cost: 0, by: {} });
    const picked = this.sel?.kind === "days" ? cells.filter((c) => this.sel.keys.has(c.t)) : [];
    const inPeriod = cells.filter((c) => c.t >= p.from && c.t < p.to);
    const peak = inPeriod.reduce((a, c) => (c.sessions > (a?.sessions ?? 0) ? c : a), null);
    const d = cells.find((c) => c.t === this.hoverDay) ?? (picked.length ? total(picked)
      : { ...total(inPeriod), label: p.label.charAt(0).toUpperCase() + p.label.slice(1), peak });
    // Left: what's shown, shortening when room runs out; right: active days and the legend, always whole.
    const readout = h_flex().h(20).gap(10).items_center().text_size(12)
      .child(h_flex().flex_1().min_w(0).gap(10).items_center().overflow_hidden()
      .child(div().flex_none().font_semibold().child(d.t != null ? `${WD[d.wd]} ${date(d.t)}` : d.label ?? this.selLabel()))
      .child(div().min_w(0).truncate().text_color(t.muted).child(!d.sessions && d.tokens ? `no session started · ${short(d.tokens)} tokens from earlier sessions' sub-agents`
        : `${d.sessions} session${d.sessions === 1 ? "" : "s"} · ${short(d.tokens)} tokens${d.cost ? ` · ${usd(d.cost)}` : ""}${d.peak ? ` · busiest ${WD[d.peak.wd]} ${date(d.peak.t)} (${d.peak.sessions})` : ""}`))
      .children(d.label ? [] : ORDER.filter((h) => d.by[h]).map((h) => h_flex().flex_none().gap(4).items_center().text_size(11).text_color(t.dim)
        .child(div().size(8).rounded(2).bg(HARNESS[h].color)).child(`${HARNESS[h].name} ${d.by[h]}`))))
      .when(!!active, (el) => el.child(div().flex_none().mr(8).text_size(11).text_color(t.dim).child(active)))
      .child(h_flex().flex_none().gap(3).items_center().text_size(11).text_color(t.dim).child(div().mr(4).child("Less"))
        .children(LEVEL.map((a, i) => div().size(11).rounded(3).bg(i ? alpha(ink, a) : t.raised))).child(div().ml(4).child("More")));
    const metrics = [["sessions", "Sessions"], ["tokens", "Tokens"], ...(cells.some((d) => d.cost) ? [["cost", "Cost"]] : [])];
    const all = cells[0].t >= p.from;
    return this.card(t, `Activity, last ${weeks} weeks${all ? "" : ` · ${p.label} highlighted`}`, this.segmented(t, "metric", metrics, this.metric, (v) => { this.metric = v; }),
      v_flex().gap(10).child(grid).child(readout));
  },

  tokensCard(t, r) {
    const m = r.mix, tot = MIX.reduce((a, [k]) => a + m[k], 0), read = m.tin + m.tcw + m.tcr;
    const share = (x) => (x > 0 && x < 0.01 ? "<1%" : pct(x));
    return this.card(t, "Where the tokens go", div().text_size(11).text_color(t.dim).child(`${short(r.tiles.tokens)} tokens, sub-agents included`), v_flex().gap(10)
      .child(this.stack(t, m, this.width - 32 - 30, 16)) // full width: Overview's last card
      .child(h_flex().flex_wrap().gap_x(24).gap_y(6).children(MIX.map(([k, label, ink]) => h_flex().gap(6).items_center().text_size(12)
        .child(div().size(10).rounded(2).bg(ink)).child(label)
        .child(div().text_color(t.muted).child(short(m[k]))).child(div().text_size(11).text_color(t.dim).child(tot ? share(m[k] / tot) : "–")))))
      .child(div().text_size(12).text_color(t.muted).child(m.tout ? `For every token written, agents read ${Math.round(read / m.tout)} of context; ${pct(r.tiles.cacheHit)} of it came from cache.` : "No token split recorded.")));
  },

  // The period, day by day (weeks past a month), by harness: sessions, spend or agent commits.
  dayCard(t, r0, r, shown) {
    const field = this.dayMetric ?? "sessions";
    const metrics = [["sessions", "Sessions"], ...(r0.tiles.costKnown ? [["cost", "Cost"]] : []), ["commits", "Commits"]];
    return this.over(t, r0, r, shown, { field, fmt: field === "cost" ? usd : short, title: r0.step === DAY ? "Day by day" : "Week by week",
      right: this.segmented(t, "daymetric", metrics, field, (v) => { this.dayMetric = v; }) });
  },

  // Where the spend went, by project (a removed worktree counts for its repo): sessions, spend, agent commits and
  // cost per commit; the rest in one row, so the rows add up to the Cost tile.
  spendCard(t, r) {
    const top = Math.max(1e-9, ...r.spend.map((x) => x.cost)), bar = Math.max(40, this.innerW() - 120 - 56 - 64 - 24);
    return this.card(t, "Where the spend went", div().text_size(11).text_color(t.dim).child("by project"), v_flex().gap(8)
      .children(r.spend.map((x) => v_flex().gap(3)
        .child(h_flex().gap(8).items_center().text_size(12)
          .child(div().flex_1().min_w(0).truncate().text_color(x.key ? t.foreground : t.muted).child(x.key ?? "Everything else"))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(`${x.sessions} session${x.sessions === 1 ? "" : "s"}`))
          .child(div().w(64).flex_none().text_right().child(usd(x.cost))))
        .child(h_flex().gap(8).items_center()
          .child(div().w(bar).h(6).rounded(3).bg(t.raised).child(div().h(6).rounded(3).w(Math.max(2, (x.cost / top) * bar)).bg(t.accent)))
          .child(div().flex_1().text_right().text_size(11).text_color(t.dim)
            .child(x.commits ? `${x.commits} commit${x.commits === 1 ? "" : "s"}${x.perCommit == null ? "" : ` · ${usd(x.perCommit)} each`}` : "no commits"))))));
  },

  workCard(t, r) {
    const w = this.innerW(), maxK = Math.max(1, ...Object.values(r.kinds)), hs = ORDER.filter((h) => r.split[h]?.runs || r.split[h]?.tok);
    return this.card(t, "What the work was", div().text_size(11).text_color(t.dim).child("from each run's mix of tools"), v_flex().gap(6)
      .children(KINDS.map(([k, label]) => h_flex().h(20).gap(8).items_center().text_size(12).when(!r.kinds[k], (el) => el.text_color(t.dim))
        .child(div().w(84).flex_none().child(label))
        .child(div().w(Math.max(40, w - 84 - 40 - 16)).h(8).rounded(3).bg(t.raised).child(div().h(8).rounded(3).w(Math.max(2, (r.kinds[k] / maxK) * Math.max(40, w - 140))).bg(t.accent)))
        .child(div().w(40).flex_none().text_right().text_size(11).text_color(t.dim).child(String(r.kinds[k] ?? 0)))))
      .child(div().h(1).my(4).bg(t.border))
      .children(hs.map((h) => h_flex().h(22).gap(8).items_center().text_size(12)
        .child(div().size(8).rounded(4).bg(HARNESS[h].color)).child(this.icon(t, h, 14)).child(div().flex_1().truncate().child(HARNESS[h].name))
        .child(div().w(72).flex_none().text_right().text_color(t.muted).child(`${r.split[h].runs} run${r.split[h].runs === 1 ? "" : "s"}`))
        .child(div().w(80).flex_none().text_right().text_size(11).text_color(t.dim).child(r.split[h].cost && r.split[h].runs ? `${usd(r.split[h].cost / r.split[h].runs)} / run` : ""))
        .child(div().w(64).flex_none().text_right().text_size(11).text_color(t.dim).child(r.split[h].cost ? usd(r.split[h].cost) : "no cost")))));
  },
};
