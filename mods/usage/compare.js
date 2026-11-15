// Usage's Compare tab: success against cost per harness x model, strengths by kind of work, cost anatomy.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { radar, alpha } from "./charts.js";
import { KINDS } from "./lib.js";
import { HARNESS, MIX, short, pct } from "./format.js";

export const compare = {
  // Model comparison, after Artificial Analysis' success-vs-cost charts: success rate up, cost of one clean run
  // across (log), one dot per harness x main model sized by runs, its 95% interval as a line.
  compare(t, r) {
    const chip = (id, label, n) => {
      const on = this.kind === id;
      return h_flex().id(`kind-${id ?? "all"}`).h(24).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer().border(1)
        .border_color(on ? t.accent : t.border).when(on, (el) => el.bg(alpha(t.accent, 0.1))).text_size(12).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.kind = id; cx.notify(); })
        .child(label).child(div().text_size(11).text_color(t.dim).child(String(n)));
    };
    const same = h_flex().id("score-same").h(24).px(8).gap(6).flex_none().items_center().rounded(6).cursor_pointer().border(1)
      .border_color(this.same ? t.accent : t.border).text_size(12).text_color(this.same ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.same = !this.same; cx.notify(); })
      .child(div().size(10).rounded(3).border(1).border_color(this.same ? t.accent : t.input).when(this.same, (el) => el.bg(t.accent))).child("Same repos only");
    const total = Object.values(r.kinds).reduce((a, n) => a + n, 0);
    const kinds = h_flex().gap(6).items_center().child(chip(null, "All work", total))
      .children(KINDS.filter(([k]) => r.kinds[k]).map(([k, label]) => chip(k, label, r.kinds[k]))).child(div().flex_1()).child(same);

    const rows = r.score, byCost = rows.some((x) => x.cps != null);
    const xOf = (x) => (byCost ? x.cps : x.tps), money = (v) => (byCost ? `$${v < 10 ? v.toFixed(2) : Math.round(v)}` : short(v));
    const plotted = rows.filter((x) => xOf(x) > 0); // log scale: a zero would put every dot at NaN
    const W = Math.max(240, this.width - 32 - 28), H = 210, L = 40, B = 22, PW = W - L - 12, PH = H - B - 10;
    let chart = null;
    if (plotted.length) {
      const vs = plotted.map(xOf), lo = Math.min(...vs) / 1.6, hi = Math.max(...vs) * 1.6;
      const ymin = Math.max(0, Math.floor(Math.min(...plotted.map((x) => x.clean.lo)) * 10) / 10);
      const X = (v) => L + ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * PW, Y = (p) => 10 + (1 - (p - ymin) / (1 - ymin || 1)) * PH;
      const maxN = Math.max(...plotted.map((x) => x.n));
      const ticks = [ymin, (ymin + 1) / 2, 1];
      chart = div().relative().w(W).h(H)
        .children(ticks.map((p) => div().absolute().left(L).top(Y(p)).w(PW).h(1).bg(t.border)))
        .children(ticks.map((p) => div().absolute().left(0).top(Y(p) - 7).w(L - 8).text_size(10).text_color(t.dim).child(pct(p))))
        // each tick under its own value (the range is padded past the cheapest and dearest, so the ends aren't them)
        .children([lo * 1.6, Math.sqrt(lo * hi), hi / 1.6].map((v) => div().absolute().top(H - B + 6).left(Math.max(L, Math.min(L + PW - 48, X(v) - 24))).w(48).text_center().text_size(10).text_color(t.dim).child(money(v))))
        .children(plotted.map((x) => {
          const key = `${x.h}|${x.model}`, s = 10 + 14 * Math.sqrt(x.n / maxN), cx_ = X(xOf(x)), on = this.hoverRow === key;
          return div().absolute().left(0).top(0).size_full()
            .child(div().absolute().left(cx_ - 1).top(Y(x.clean.hi)).w(2).h(Math.max(2, Y(x.clean.lo) - Y(x.clean.hi))).bg(alpha(HARNESS[x.h].color, 0.45)))
            .child(div().id(`dot-${key}`).absolute().left(cx_ - s / 2).top(Y(x.clean.p) - s / 2).size(s).rounded(s).bg(HARNESS[x.h].color)
              .border(2).border_color(on ? t.foreground : t.surface).cursor_pointer()
              .on_hover((h, cx) => { if (h) this.hoverRow = key; else if (this.hoverRow === key) this.hoverRow = null; cx.notify(); }));
        }));
    }
    const focus = rows.find((x) => `${x.h}|${x.model}` === this.hoverRow) ?? r.best ?? rows[0];
    const readout = !focus ? null : h_flex().h(20).gap(8).items_center().text_size(12)
      .child(this.icon(t, focus.h, 14)).child(div().font_semibold().child(`${HARNESS[focus.h].name} · ${focus.model}`))
      .child(div().truncate().text_color(t.muted).child(`${pct(focus.clean.p)} clean (${pct(focus.clean.lo)}–${pct(focus.clean.hi)}) · ${xOf(focus) != null ? `${money(xOf(focus))} per clean run` : "no cost recorded"} · ${focus.loops} tool loops per run · ${focus.n} runs`));

    const wide = this.width >= 640;
    const head = (label, w) => div().w(w).flex_none().text_size(11).text_color(t.dim).child(label);
    const table = v_flex().gap(2)
      .child(h_flex().h(20).gap(8).items_center().child(div().flex_1().text_size(11).text_color(t.dim).child("Harness · main model"))
        .child(head("Runs", 36)).child(head("Success", 108)).child(head(byCost ? "Cost / clean run" : "Tokens / clean run", 96)).child(head("Tool loops", 64))
        .when(wide, (el) => el.child(head("Led to a commit", 108))))
      .children(rows.map((x) => h_flex().id(`score-${x.h}-${x.model}`).h(28).gap(8).items_center().rounded(6)
        .when(this.hoverRow === `${x.h}|${x.model}`, (el) => el.bg(t.hover)).when(r.best === x, (el) => el.bg(alpha(t.done, 0.08)))
        .on_hover((h, cx) => { const key = `${x.h}|${x.model}`; if (h) this.hoverRow = key; else if (this.hoverRow === key) this.hoverRow = null; cx.notify(); })
        .child(h_flex().flex_1().min_w(0).gap(6).items_center().child(div().size(8).rounded(4).flex_none().bg(HARNESS[x.h].color)).child(this.icon(t, x.h, 14))
          .child(div().flex_none().text_size(12).child(HARNESS[x.h].name)).child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(x.model))
          .when(r.best === x, (el) => el.child(h_flex().h(18).px(6).flex_none().items_center().rounded(5).bg(alpha(t.done, 0.16)).text_size(11).text_color(t.done).child("best for you"))))
        .child(div().w(36).flex_none().text_size(12).child(String(x.n)))
        .child(this.ci(t, x.clean, t.done))
        .child(div().w(96).flex_none().text_size(12).child(xOf(x) != null ? money(xOf(x)) : "–"))
        .child(div().w(64).flex_none().text_size(12).child(String(x.loops)))
        .when(wide, (el) => el.child(this.ci(t, x.commit, t.accent)))));
    const verdict = !rows.length ? "Not enough runs here yet: a harness × model needs 3 or more." : r.best ? null
      : "No clear winner yet: the intervals overlap, so the gaps could be chance.";
    const notes = "Success: share of clean runs (no abort, API error or context compaction; under 10% failed tool calls), with its 95% interval. Cost / clean run: all recorded spend, failed runs included, over the clean runs (API prices; Codex records none, so tokens stand in). Tool loops: median tool calls per run. Kind of work comes from each run's mix of tools. Main model: most tokens in the run.";
    return v_flex().gap(12)
      .child(kinds)
      .child(this.card(t, "Success against cost", div().text_size(11).text_color(t.dim).child(`↖ better and cheaper · across: ${byCost ? "cost of one clean run" : "tokens per clean run"}, log scale`), v_flex().gap(8)
        .child(chart ?? div().text_center().text_size(12).text_color(t.dim).child("Nothing to plot: no harness × model has 3 runs here."))
        .when(Boolean(readout), (el) => el.child(readout))))
      .child(this.card(t, "Model comparison", null, v_flex().gap(10).child(table)
        .when(Boolean(verdict), (el) => el.child(div().text_size(12).text_color(t.muted).child(verdict)))
        .child(div().text_size(11).text_color(t.dim).child(notes))))
      .when(rows.length > 0, (el) => el.child(this.anatomy(t, r)));
  },

  // What each harness and model is good at, two ways. A grid first, pairs by kind of work, for "who's best at
  // Build?": each cell's clean-run rate as its tint, the best in each column outlined. Then a radar per pair (10+
  // sessions, the six busiest) with each kind's numbers beside it, two to a row, for each pair's shape. A kind needs 5+
  // runs to be measured; best and weakest go by the low end of the rate's interval.
  strengthsCard(t, r) {
    const W = this.width - 32 - 30, list = r.strengths, name = (k) => KINDS.find(([x]) => x === k)[1];
    const color = (x) => HARNESS[x.h]?.color ?? t.accent, rate = (v) => `${pct(v.clean)} (${v.ok}/${v.n})`;
    // Hovering a cell or row: its numbers in a readout, in the card's own type (Herdr's tooltips are one plain line).
    const key = (x, k) => `${x.h}|${x.model}|${k}`, hovered = this.strHover;
    const hover = (el, x, k) => el.on_hover((on, cx) => {
      if (on) this.strHover = key(x, k); else if (this.strHover === key(x, k)) this.strHover = null;
      cx.notify();
    });
    const detail = (x, k, label, v, withPair) => h_flex().flex_wrap().gap_x(6).gap_y(2).items_baseline().text_size(12)
      .when(withPair, (el) => el.child(div().font_medium().child(`${HARNESS[x.h]?.name ?? x.h} · ${x.model}`)))
      .child(div().font_medium().text_color(withPair ? t.muted : t.foreground).child(label))
      .child(div().text_color(t.foreground).child(v.clean == null ? `${v.n} run${v.n === 1 ? "" : "s"}: under the 5 needed to score it`
        : `${v.ok} of ${v.n} runs clean (${pct(v.clean)})`));
    const at = hovered ? list.flatMap((x) => KINDS.map(([k, label]) => ({ x, k, label }))).find((c) => key(c.x, c.k) === hovered) : null;
    const best = Object.fromEntries(KINDS.map(([k]) => {
      const m = list.filter((x) => x.kinds[k].clean != null).sort((a, b) => b.kinds[k].lo - a.kinds[k].lo);
      return [k, m.length > 1 ? m[0] : null];
    }));
    const who = (x) => h_flex().w(Math.min(300, W * 0.3)).flex_none().gap(6).items_center().text_size(12)
      .child(this.icon(t, x.h, 14)).child(div().flex_none().font_medium().child(HARNESS[x.h]?.name ?? x.h))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(x.model));
    const grid = v_flex().gap(4)
      .child(h_flex().gap(4).child(div().w(Math.min(300, W * 0.3)).flex_none())
        .children(KINDS.map(([, label]) => div().flex_1().min_w(0).truncate().text_center().text_size(11).text_color(t.dim).child(label))))
      .children(list.map((x) => h_flex().gap(4).items_center().child(who(x)).children(KINDS.map(([k, label]) => {
        const v = x.kinds[k], on = best[k] === x;
        const lit = hovered === key(x, k);
        return hover(v_flex().id(`str-${x.h}-${x.model}-${k}`), x, k).flex_1().min_w(0).h(40).items_center().justify_center().rounded(6)
          .bg(v.clean == null ? t.raised : alpha(t.done, 0.12 + 0.55 * v.clean))
          .border(1).border_color(lit ? t.accent : on ? t.foreground : alpha(t.border, 0))
          .child(div().text_size(12).font_medium().text_color(v.clean == null ? t.dim : t.foreground).child(v.clean == null ? "" : pct(v.clean)))
          .child(div().text_size(10).text_color(v.clean == null ? t.dim : t.muted).child(v.n ? `${v.n} run${v.n === 1 ? "" : "s"}` : ""));
      }))));
    // two to a row from 900pt; a tile from 440pt carries its table beside a 190pt radar
    const cols = W >= 900 ? Math.min(2, list.length) : 1, tw = (W - 12 * (cols - 1)) / cols, wide = tw >= 440;
    const size = wide ? 190 : Math.min(230, tw - 20);
    const table = (x) => v_flex().flex_1().min_w(0).gap(6).justify_center().children(KINDS.map(([k, label]) => {
      const v = x.kinds[k];
      return hover(h_flex().id(`strow-${x.h}-${x.model}-${k}`), x, k).h(20).px(4).gap(8).items_center().rounded(4).text_size(12)
        .when(hovered === key(x, k), (el) => el.bg(t.hover))
        .child(div().w(84).flex_none().text_color(v.clean == null ? t.dim : t.foreground).child(label))
        .child(div().flex_1().h(6).rounded(3).bg(t.raised).child(div().h(6).rounded(3).w(`${Math.round((v.clean ?? 0) * 100)}%`).bg(color(x))))
        .child(div().w(40).flex_none().text_right().text_color(v.clean == null ? t.dim : t.foreground).child(v.clean == null ? "–" : pct(v.clean)))
        .child(div().w(52).flex_none().text_right().text_size(11).text_color(t.dim).child(`${v.n} run${v.n === 1 ? "" : "s"}`));
    }));
    const tile = (x) => v_flex().flex_1().min_w(0).p(12).gap(6).rounded(8).border(1).border_color(t.border)
      .child(h_flex().w_full().gap(8).items_center().child(who(x).flex_1()).child(div().flex_none().text_size(11).text_color(t.dim).child(`${x.n} runs`)))
      .child(h_flex().w_full().gap(16).items_center().justify_center()
        .child(radar(t, { size, labels: KINDS.map(([, label]) => label), values: KINDS.map(([k]) => x.kinds[k].clean), color: color(x) }))
        .when(wide, (el) => el.child(table(x))))
      // the footer: the hovered row's numbers while one is, else best and weakest
      .child(at && at.x === x // two lines tall either way, for the same reason as the grid's readout
        ? div().h(34).overflow_hidden().child(detail(x, at.k, at.label, x.kinds[at.k], false))
        : h_flex().w_full().h(34).items_start().gap(8).justify_between().text_size(11)
          .child(div().truncate().text_color(t.done).child(x.best ? `Best: ${name(x.best)} ${rate(x.kinds[x.best])}` : "Too few runs of any one kind"))
          .child(div().truncate().text_color(t.muted).child(x.worst ? `Weakest: ${name(x.worst)} ${rate(x.kinds[x.worst])}` : "")));
    const rows = [];
    for (let i = 0; i < list.length; i += cols) rows.push(h_flex().gap(12).items_stretch().children(list.slice(i, i + cols).map(tile)));
    // under the grid: the hovered cell's numbers, else what hovering gives. Two lines tall whatever it says, so a long
    // detail that wraps doesn't push the radars down and slide another cell under the pointer.
    const readout = div().h(36).overflow_hidden().child(at
      ? detail(at.x, at.k, at.label, at.x.kinds[at.k], true)
      : div().text_size(12).text_color(t.dim).child("Hover a cell for its runs."));
    return this.card(t, "Strengths by kind of work", div().text_size(11).text_color(t.dim).child("clean runs per kind · a kind needs 5 runs · outlined: best in its column"),
      v_flex().gap(16).children(list.length > 1 ? [v_flex().gap(8).child(grid).child(readout)] : []).children(rows));
  },

  // What the spend is made of, per harness x main model: the token mix and what a token, an output token and a
  // run that led to a commit cost. Agent loops re-read their context every step, so read per written dominates.
  anatomy(t, r) {
    const rows = r.score, wide = this.width >= 640, bar = Math.max(80, this.width - 32 - 28 - 210 - (wide ? 4 * 72 : 2 * 72) - 40);
    const head = (label, w) => div().w(w).flex_none().text_size(11).text_color(t.dim).child(label);
    const usd = (v, d = 2) => (v == null ? "–" : `$${v < 10 ? v.toFixed(d) : Math.round(v)}`);
    return this.card(t, "Cost anatomy", null, v_flex().gap(4)
      .child(h_flex().h(20).gap(8).items_center().child(div().w(210).flex_none().text_size(11).text_color(t.dim).child("Harness · main model"))
        .child(head("Token mix", bar)).child(head("$ / 1M tok", 72)).child(head("$ / 1K out", 72)).when(wide, (el) => el.child(head("Read : write", 72)).child(head("$ / commit", 72))))
      .children(rows.map((x) => h_flex().id(`anat-${x.h}-${x.model}`).h(28).gap(8).items_center()
        .child(h_flex().w(210).flex_none().min_w(0).gap(6).items_center().child(div().size(8).rounded(4).flex_none().bg(HARNESS[x.h].color)).child(this.icon(t, x.h, 14))
          .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(x.model)))
        .child(this.stack(t, x.mix, bar, 12))
        .child(div().w(72).flex_none().text_size(12).child(usd(x.per1M)))
        .child(div().w(72).flex_none().text_size(12).child(usd(x.per1kOut, 3)))
        .when(wide, (el) => el.child(div().w(72).flex_none().text_size(12).child(x.readPerOut == null ? "–" : `${Math.round(x.readPerOut)} : 1`)).child(div().w(72).flex_none().text_size(12).child(usd(x.perCommit))))))
      .child(h_flex().pt(6).gap(12).items_center().children(MIX.map(([, label, ink]) => h_flex().gap(5).items_center().text_size(11).text_color(t.muted).child(div().size(10).rounded(2).bg(ink)).child(label))))
      .child(div().text_size(11).text_color(t.dim).child("$ / 1M tok: recorded spend over all tokens (the blended price you actually paid, cache discounts included). $ / 1K out: spend per thousand output tokens, the text and code delivered. Read : write: context tokens read (fresh, cache write, cache read) per token written. $ / commit: spend over the runs that led to a commit. Codex records no cost, so its $ columns stay empty.")));
  },
  // The interval as a bar: the 95% range shaded, the observed rate as a tick.
  ci(t, w, color) {
    const W = 64;
    if (!w) return div().w(W + 44).text_size(11).text_color(t.dim).child("–");
    return h_flex().w(W + 44).gap(6).items_center()
      .child(div().relative().w(W).h(8).rounded(2).bg(t.raised)
        .child(div().absolute().top(0).h(8).rounded(2).left(w.lo * W).w(Math.max(2, (w.hi - w.lo) * W)).bg(alpha(color, 0.35)))
        .child(div().absolute().top(0).h(8).w(2).left(Math.min(W - 2, w.p * W)).bg(color)))
      .child(div().text_size(12).child(pct(w.p)));
  },
};
