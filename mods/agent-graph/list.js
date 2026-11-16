// The Agents view as an indented list (Graph | List: List), the same tree as the graph. A method of AgentGraph
// (main.js installs it on the prototype), so it reads the view's state through `this`.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Scrollbar } from "gpui-base";
import { subState, metricLine } from "./lib.js";

const MAX_FILES = 8; // a selected sub-agent's edited files listed under its row
const WORD = { blocked: "Blocked", done: "Done", working: "Working", idle: "Idle" };
const ICON = (f) => `mods/agent-graph/${f}.svg`;
const ESTIMATE = "≈ at API prices (subscription)";
const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");

export function list(t, tree) {
  const rows = [];
  const row = (id, depth) => h_flex().id(id).h(28).flex_none().pl(8 + depth * 16).pr(8).gap(8).items_center().rounded(7);
  const dim = (text) => div().flex_none().text_size(11).text_color(t.dim).child(text);
  const agent = (a, depth) => {
    const loud = a.status === "blocked", tone = loud ? t.blocked : a.status === "working" ? t.working : null, sel = this.sel === a.id, p = a.program;
    const ic = p?.icon ? (p.tint ? svg(p.icon).size(14).flex_none().text_color(t.foreground) : image(p.icon).w(14).h(14).flex_none()) : null;
    const sub = a.sub, warn = this.cardConflicts(a), tip = this.tip(a), line = metricLine(a.history ? a.total : a.m ?? a.total);
    rows.push(row(`l:${a.id}`, depth).border_1().border_color(a.here ? t.accent : alpha(t.border, 0)).cursor_pointer()
      .when(!!tone, (el) => el.bg(alpha(tone, 0.08))).when(sel && !tone, (el) => el.bg(t.selected))
      .hover((s) => s.bg(tone ? alpha(tone, 0.14) : t.hover))
      .when(!!tip, (el) => el.tooltip(tip))
      .on_click((_e, cx) => { if (sub || a.history) this.sel = a.id; if (a.history) { this.toggle(a); cx.notify(); } else this.open(a); })
      .child(this.chevron(t, a, 1))
      .child(this.dot(t, a.status, 8))
      .when(!!ic && !a.history, (el) => el.child(ic))
      .child(div().flex_1().min_w(0).truncate().text_color(a.history ? t.muted : t.foreground).child(a.name))
      .map((el) => this.branchTag(t, el, a, 1, true))
      .when(warn.length > 0, (el) => el.child(this.warn(t, `w-${a.id}`, warn, 1, false)))
      .when(!a.history, (el) => el.child(sub // what it's doing now shares the row with its title
        ? div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(subState(sub, this.now))
        : div().flex_none().text_size(11).text_color(loud ? t.blocked : t.dim).when(loud, (el) => el.font_semibold())
          .child(a.agent ? WORD[a.status] : a.kind)))
      .when(!!sub?.edited.length, (el) => el.child(dim(`✎ ${sub.edited.length}`)))
      .when(!!line, (el) => el.child(dim(line)))
      .when(a.folded && !a.history, (el) => el.child(this.summaryChip(t, a, 1))));
    if (sub && sel) {
      for (const e of sub.edited.slice(0, MAX_FILES)) rows.push(row(`l:${a.id}|${e.path}`, depth + 1).h(22).child(this.file(t, e, 1)));
      const more = sub.edited.length - MAX_FILES;
      if (more > 0) rows.push(row(`l:${a.id}|more`, depth + 1).h(22).text_size(11).text_color(t.dim).child(`+${more} more`));
    }
    for (const c of a.children) agent(c, depth + 1);
  };
  for (const r of tree) {
    const none = r.kind === "none";
    rows.push(row(`l:${r.id}`, 0).when(rows.length > 0, (el) => el.mt(8))
      .when(!none, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(`Every worktree of ${r.name}`).on_click(() => this.worktrees(r)))
      .child(svg(ICON(none ? "folder" : "repo")).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(none ? t.muted : t.foreground).child(r.name))
      .when(!!r.machine, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(r.machine))));
    for (const w of r.worktrees) {
      const git = w.kind === "worktree";
      const ab = git && (w.ahead || w.behind) ? [w.ahead && `↑${w.ahead}`, w.behind && `↓${w.behind}`].filter(Boolean).join(" ") : "";
      const total = this.totalLine(w.total);
      rows.push(row(`l:${w.id}`, 1).border_1().border_color(w.here ? t.accent : alpha(t.border, 0))
        .when(this.sel === w.id, (el) => el.bg(t.selected)).on_click((_e, cx) => { this.sel = w.id; cx.notify(); })
        .child(this.chevron(t, w, 1))
        .child(svg(ICON(git ? "branch" : "folder")).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(git ? w.branch ?? "detached" : w.name))
        .when(!!ab, (el) => el.child(dim(ab)))
        .when(this.owners.has(w.id), (el) => el.child(this.workedBy(t, w, w.path, 11).flex_none().max_w(200)))
        .map((el) => { const f = this.worktreeConflicts(w); return f.length ? el.child(this.warn(t, `w-${w.id}`, f, 1, true)) : el; })
        .when(!!total, (el) => el.child(dim(total).id(`lt-${w.id}`).when(w.total.estimate, (el) => el.tooltip(ESTIMATE))))
        .when(w.folded, (el) => el.child(this.summaryChip(t, w, 1)))
        .when(!!w.pr, (el) => el.child(this.chip(t, w, 1))));
      for (const a of w.agents) agent(a, 2);
    }
  }
  return this.measure(div().id("ag-list-body").flex_1().min_h(0).relative())
    .child(v_flex().id("ag-list").absolute().inset_0().overflow_y_scroll().p(6).children(rows))
    .child(Scrollbar.vertical("ag-list").absolute().inset_0());
}
