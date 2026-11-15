// Usage's Skills tab.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { alpha } from "./charts.js";
import { FEW } from "./lib.js";
import { HARNESS, pct, usd, num } from "./format.js";

export const skills = {
  // ---- Skills: which do well ----

  // Each skill (or category) against the same harnesses' sessions without it: sessions, median commits, cost per
  // commit, median cost per session, clean runs. Sortable; a row opens its harnesses and models. Correlation, not cause.
  skillsView(t, sk, p) {
    const { rows, tiles } = sk ?? { rows: [], tiles: {} };
    if (!tiles.sessions) return [div().p(12).text_center().text_size(13).text_color(t.muted).child(`No sessions in ${p.label} for the harnesses shown.`)];
    const by = this.skillBy ?? "skill", sort = this.skillSort ?? "n";
    const head = this.tileRow(t, [
      ["Sessions with a skill", `${tiles.skilled} of ${tiles.sessions}`, `${pct(tiles.skilled / tiles.sessions)} of sessions`],
      ["Skills used", String(tiles.distinct), tiles.top ? `most used: ${tiles.top}` : "none yet"],
      ["Median cost with a skill", tiles.costSkilled == null ? "–" : `${usd(tiles.costSkilled)} / session`, `without: ${usd(tiles.costUnskilled)} / session`],
      ["Categories", String(new Set(rows.map((x) => x.category)).size), by === "category" ? "grouped by category" : "switch to Categories to group"],
    ]);
    if (!rows.length) return [head, div().p(12).text_center().text_size(13).text_color(t.muted).child(`No skills used in ${p.label}. A skill counts when Claude Code calls it, or another harness's agent reads its SKILL.md.`)];
    const key = { n: (x) => x.n, commits: (x) => x.commitsMed ?? -1, perCommit: (x) => -(x.perCommit ?? Infinity), cost: (x) => -(x.costMed ?? Infinity), clean: (x) => x.clean?.lo ?? -1 }[sort];
    const sorted = [...rows].sort((a, b) => key(b) - key(a) || b.n - a.n || a.key.localeCompare(b.key));
    const W = { n: 64, v: 104, clean: 88 };
    // A value against its baseline: ▲ / ▼ only when the difference is real (20%+) and the sample isn't tiny.
    const vs = (x, base, fmt, higherIsBetter, few) => {
      const d = x != null && base ? (x - base) / Math.abs(base) : null, big = !few && d != null && Math.abs(d) >= 0.2;
      const good = big && (d > 0) === higherIsBetter;
      return v_flex().w(W.v).flex_none().items_end().gap(2)
        .child(h_flex().gap(4).items_center().child(div().text_size(12.5).child(fmt(x)))
          .when(big, (el) => el.child(div().text_size(10).text_color(good ? t.done : t.blocked).child(d > 0 ? "▲" : "▼"))))
        .child(div().text_size(11).text_color(t.dim).child(`${fmt(base)} without`));
    };
    const hcell = (id, label, w, sortKey) => div().id(`sk-h-${id}`).w(w).flex_none().text_right().cursor_pointer()
      .text_color(sort === sortKey ? t.foreground : t.dim).hover((x) => x.text_color(t.foreground))
      .on_click((_e, cx) => { this.skillSort = sortKey; cx.notify(); }).child(label + (sort === sortKey ? " ↓" : ""));
    const header = h_flex().h(28).px(10).gap(8).items_center().text_size(11.5).font_medium().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).text_color(t.dim).child(by === "category" ? "Category" : "Skill"))
      .child(hcell("n", "Sessions", W.n, "n")).child(hcell("commits", "Commits", W.v, "commits"))
      .child(hcell("perCommit", "Cost per commit", W.v, "perCommit"))
      .child(hcell("cost", "Median cost", W.v, "cost")).child(hcell("clean", "Clean runs", W.clean, "clean"));
    // An open skill is one block: its row and this breakdown share a tinted, outlined box; the breakdown sits inset in a
    // slightly deeper shade of that tint, each harness with its colour, so it never reads as the next skill.
    const breakdown = (x) => {
      const table = (title, list, label, color) => v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(11.5).font_medium().text_color(t.muted).child(title))
        .children(list.map((g) => h_flex().h(22).gap(8).items_center().text_size(12)
          .child(div().size(8).flex_none().rounded(2).bg(color(g.key)))
          .child(div().flex_1().min_w(0).truncate().child(label(g.key)))
          .child(div().w(70).flex_none().text_right().text_color(t.muted).child(`${g.n} run${g.n === 1 ? "" : "s"}`))
          .child(div().w(90).flex_none().text_right().text_color(t.muted).child(`${num(g.commitsMed)} commits`))
          .child(div().w(110).flex_none().text_right().text_color(t.muted).child(g.perCommit == null ? "–" : `${usd(g.perCommit)} / commit`))
          .child(div().w(70).flex_none().text_right().text_color(t.muted).child(usd(g.costMed)))));
      return v_flex().mx(8).px(12).py(10).gap(12).bg(alpha(t.background, 0.35)).rounded(6)
        .child(table("By harness", x.harnesses, (h) => HARNESS[h]?.name ?? h, (h) => HARNESS[h]?.color ?? t.dim))
        .child(table("By model", x.models, (m) => m, () => t.dim));
    };
    const row = (x) => {
      const on = this.skillSel === x.key;
      return v_flex().rounded(8).border(1).border_color(on ? alpha(t.accent, 0.5) : alpha(t.border, 0))
        .when(on, (el) => el.bg(t.selected).pb(8).my(4))
        .child(h_flex().id(`sk-${x.key}`).min_h(44).px(10).gap(8).items_center().rounded(8).cursor_pointer()
          .when(!on, (el) => el.hover((s) => s.bg(t.hover))).when(x.few, (el) => el.opacity(0.6))
          .when(x.few, (el) => el.tooltip(`Only ${x.n} session${x.n === 1 ? "" : "s"}: too few to tell`))
          .on_click((_e, cx) => { this.skillSel = on ? null : x.key; cx.notify(); })
          .child(v_flex().flex_1().min_w(0).gap(2).child(div().truncate().text_size(13).child(x.key))
            .child(div().truncate().text_size(11).text_color(t.dim).child(by === "skill" ? x.category : `${x.base.n} sessions without it`)))
          .child(div().w(W.n).flex_none().text_right().text_size(12.5).child(String(x.n)))
          .child(vs(x.commitsMed, x.base.commitsMed, num, true, x.few))
          .child(vs(x.perCommit, x.base.perCommit, usd, false, x.few))
          .child(vs(x.costMed, x.base.costMed, usd, false, x.few))
          .child(v_flex().w(W.clean).flex_none().items_end().gap(2).child(div().text_size(12.5).child(pct(x.clean?.p)))
            .child(div().text_size(11).text_color(t.dim).child(x.clean ? `${pct(x.clean.lo)}–${pct(x.clean.hi)}` : ""))))
        .when(on, (el) => el.child(breakdown(x)));
    };
    const switcher = h_flex().h(24).p(2).gap(2).flex_none().items_center().rounded(7).bg(t.raised).children([["skill", "Skills"], ["category", "Categories"]].map(([v, label]) =>
      div().id(`sk-by-${v}`).h(20).px(8).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .text_color(v === by ? t.foreground : t.muted).when(v === by, (el) => el.bg(t.background))
        .hover((x) => x.text_color(t.foreground)).on_click((_e, cx) => { this.skillBy = v; this.skillSel = null; cx.notify(); }).child(label)));
    const table = this.card(t, "Which skills do well", switcher, v_flex().gap(2).child(header).children(sorted.map(row))
      .child(div().pt(8).text_size(11).text_color(t.dim).child(`Each against the same harnesses' sessions without it. Fewer than ${FEW} sessions: dimmed, too few to tell. Commits: the median per session, made by its agent or its sub-agents. Cost per commit: spend over those commits (Codex records no cost). Correlation, not cause; a session that used several skills counts for each.`)));
    return [head, table];
  },
};
