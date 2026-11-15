// Usage's Output tab: what the work delivered (git and gh).
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { alpha } from "./charts.js";
import { addDays, DAY } from "./lib.js";
import { WD, short, date, mins } from "./format.js";

export const outputTab = {
  // What the work delivered: commits, lines, PRs, worktrees, and what agent spend each of them cost.
  outputView(t, r0, r, p, o0, o) {
    if (!o) return [div().p(12).text_center().text_size(13).text_color(t.muted).child(this.busy ? "Reading git and gh in your repos…" : "No git or gh data yet: rescan (↻).")];
    const base = (path) => path.split("/").filter(Boolean).pop();
    const tiles = this.tileRow(t, [
      ["Commits", String(o.commits), o.activeDays ? `${(o.commits / o.activeDays).toFixed(1)} per day you committed` : "none"],
      ["Lines changed", `+${short(o.add)} −${short(o.del)}`, `net ${o.add - o.del >= 0 ? "+" : "−"}${short(Math.abs(o.add - o.del))} · lockfiles left out`],
      ["Pull requests", `${o.opened} opened`, o.merged ? `${o.merged} merged · median ${mins(o.mergeHours * 60)} to merge` : "none merged"],
      ["Worktrees", String(o.worktrees), `across ${o.treeRepos} repos, now`],
    ]);
    // Lines added above the axis, removed below, one bar per day (week, past a month); hover for the day's numbers,
    // press or drag to pick days. With days picked the bars stay whole (the picked ones lit).
    const days = this.sel?.kind === "days", ob = days ? o0 : o, step = (days ? r0 : r).step;
    const max = Math.max(1, ...ob.buckets.map((b) => Math.max(b.add, b.del))), UP = 64, DOWN = 36, x = ob.buckets.find((b) => b.t === this.hoverOut);
    const chart = h_flex().h(UP + DOWN + 1).gap(2).items_center().overflow_hidden().children(ob.buckets.map((b) => {
      const at = [b.t, step === DAY ? b.t : Math.min(addDays(b.t, 6), this.last)];
      return this.pick(v_flex().id(`out-${b.t}`).flex_1().min_w(0).h(UP + DOWN + 1).when(!this.lit(at), (el) => el.opacity(0.3))
        .when(this.hoverOut === b.t, (el) => el.bg(t.hover)).rounded(2), "days", at, (on) => { if (on) this.hoverOut = b.t; else if (this.hoverOut === b.t) this.hoverOut = null; })
        .child(v_flex().h(UP).justify_end().child(div().w_full().h(b.add ? Math.max(2, (b.add / max) * UP) : 0).rounded_t(2).bg(alpha(t.done, 0.85))))
        .child(div().h(1).w_full().bg(t.border))
        .child(v_flex().h(DOWN).child(div().w_full().h(b.del ? Math.max(2, (b.del / max) * DOWN) : 0).rounded_b(2).bg(alpha(t.blocked, 0.75))));
    }));
    const lines = this.card(t, "Commits and lines", div().text_size(11).text_color(t.dim).child("added above the line, removed below"), v_flex().gap(8).child(chart)
      .child(h_flex().h(18).gap(10).items_center().text_size(12)
        .child(div().font_semibold().child(x ? `${step === DAY ? WD[(new Date(x.t).getDay() + 6) % 7] : "Week of"} ${date(x.t)}` : this.sel ? this.selLabel() : p.label))
        .child(div().text_color(t.muted).child(x ? `${x.commits} commits · +${short(x.add)} −${short(x.del)}${x.merged ? ` · ${x.merged} PR${x.merged === 1 ? "" : "s"} merged` : ""}`
          : this.sel ? `${o.commits} commits · +${short(o.add)} −${short(o.del)}` : "hover a bar for its day · press or drag to pick days"))));
    const w = this.innerW(), top = Math.max(1, ...o.repos.map((x) => x.commits));
    const where = this.card(t, "Where you committed", null, v_flex().gap(4).children(o.repos.map((x) => h_flex().h(20).gap(8).items_center().text_size(12)
      .child(div().w(110).flex_none().truncate().child(base(x.repo)))
      .child(div().w(Math.max(40, w - 110 - 90 - 16)).h(8).rounded(3).bg(t.raised).child(div().h(8).rounded(3).w(Math.max(2, (x.commits / top) * Math.max(40, w - 216))).bg(t.accent)))
      .child(div().w(90).text_size(11).text_color(t.dim).child(`${x.commits} · +${short(x.add)}`)))));
    // Agent spend against what it delivered (recorded cost only; Codex records none).
    const spend = r.tiles.cost, per = (n, d = 2) => (r.tiles.costKnown && n ? `$${(spend / n).toFixed(d)}` : "–");
    const cost = this.card(t, "What delivery cost", div().text_size(11).text_color(t.dim).child("agent spend over output"), v_flex().gap(4).children([
      ["Per commit", per(o.commits)], ["Per merged PR", per(o.merged, 0)], ["Per 1K lines changed", per((o.add + o.del) / 1000)],
      ["Tokens per commit", o.commits ? short(r.tiles.tokens / o.commits) : "–"], ["Commits per agent run", r.tiles.sessions ? (o.commits / r.tiles.sessions).toFixed(1) : "–"],
    ].map(([label, value]) => h_flex().h(22).items_center().justify_between().text_size(12).child(div().text_color(t.muted).child(label)).child(div().font_semibold().child(value)))));
    const prs = o.recent.length ? this.card(t, "Recent pull requests", null, v_flex().gap(2).children(o.recent.map((x) => h_flex().h(24).gap(8).items_center().text_size(12)
      .child(div().w(44).flex_none().text_color(t.muted).child(`#${x.n}`)).child(div().flex_1().min_w(0).truncate().child(base(x.repo)))
      .child(h_flex().h(18).px(6).flex_none().items_center().rounded(5).text_size(11)
        .bg(alpha(x.state === "merged" ? t.done : x.state === "open" ? t.accent : t.dim, 0.16)).text_color(x.state === "merged" ? t.done : x.state === "open" ? t.accent : t.dim).child(x.state))
      .child(div().w(130).flex_none().whitespace_nowrap().text_size(11).text_color(t.dim).child(x.merged ? `merged in ${mins((x.merged - x.created) / 60000)}` : date(x.created)))))) : null;
    return [tiles, lines, this.pair(where, cost), ...(prs ? [prs] : [])];
  },
};
