// Jump (⌘E): your last few sessions, then every space as the sidebar nests them (lib jumpRows), a line a row: a
// repo's main checkout, its worktree spaces under it, then its worktrees nothing has open. A space with one session is
// one row (↵ goes to the session); with more, its sessions sit under it. The session you showed before this one is
// picked (tabs-plus records the order in shared "jump.recent"), so ⌘E ↵ goes back and again comes forth.
// Each session shows what its agent is on (the terminal title it sets) and how long it has been in its state.
// Type to filter: every word, anywhere in a row (names, branch, agent, what it's on, its state: "needs you"; its folder
// counts least); matches keep their parents. A branch name nothing has offers a new worktree for it, in your repo.
// ↑/↓ to pick, ↵ to go (a worktree opens as a space), Esc to leave.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, spaces, panes, focused, exec, run, theme, props, shared, setShared, openOverlay, closeOverlay, home } from "herdr";
import { jumpRows, rowKey, selected, step, STATE } from "./lib.js";

const tilde = (p) => (p && home() && (p === home() || p.startsWith(`${home()}/`)) ? `~${p.slice(home().length)}` : p ?? "");
const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const ROW_H = 28, INDENT = 16;

// The checkouts of every repo a terminal is in, each repo once, newest commit first, read in parallel:
// { path, branch, machine, repo, key (machine + git common dir: one per repo), main (the repo's own), at (last commit, ms) }.
async function worktrees() {
  const dirs = new Map(panes().filter((p) => p.terminal && p.cwd).map((p) => {
    const machine = spaces().find((s) => s.tabs.some((t) => t.id === p.tab))?.machine ?? null;
    return [`${machine ?? ""}\n${p.cwd}`, { cwd: p.cwd, machine }];
  }));
  const git = (cwd, machine, ...args) => exec("git", args, { cwd, on: machine ?? undefined }).catch(() => ({ code: 1 }));
  const commons = await Promise.all([...dirs.values()].map(async ({ cwd, machine }) => {
    const r = await git(cwd, machine, "rev-parse", "--path-format=absolute", "--git-common-dir");
    return r.code === 0 ? { cwd, machine, key: `${machine ?? ""}\n${r.stdout.trim()}` } : null;
  }));
  const repos = [...new Map(commons.filter(Boolean).map((c) => [c.key, c])).values()];
  const lists = await Promise.all(repos.map(async ({ cwd, machine, key }) => {
    const [list, refs] = await Promise.all([git(cwd, machine, "worktree", "list", "--porcelain"),
      git(cwd, machine, "for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads")]);
    if (list.code !== 0) return [];
    const when = new Map((refs.stdout ?? "").trim().split("\n").map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) * 1000 || 0]));
    const out = [];
    let repo = null;
    list.stdout.trim().split(/\n\n+/).forEach((block, n) => {
      const lines = block.split("\n"), path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
      if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) return;
      repo ??= path.split("/").pop();
      const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
      out.push({ path, machine, repo, key, branch, main: n === 0, at: when.get(branch) ?? 0 }); // git lists the main checkout first
    });
    return out;
  }));
  return lists.flat().sort((a, b) => b.at - a.at);
}

export default class Jump extends View {
  init(_props, cx) {
    setShared("emergence.over", { at: Date.now(), open: true }); // the keyboard goes back where it was when this closes
    this.input = InputState.new({ placeholder: "Jump to a space, session or branch…" });
    this.input.on("change", (_e, cx) => { this.sel = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => { const l = this.list(); this.go(l.rows[selected(l, this.sel)], cx); });
    this.input.focus();
    cx.timer.after(150, () => this.input.focus());
    this.sel = null; // the highlighted row's key (lib rowKey), from ↑/↓; null: jumpRows' pick
    this.scrolled = null; // the row last scrolled to
    this.expanded = new Set(); // repos whose unopened worktrees are all shown ("N more" ↵)
    this.wts = [];
    this.scroll = ScrollHandle.new();
    cx.spawn(async (cx) => { await cx.sleep(16); this.wts = await worktrees(); cx.notify(); }); // host calls before the first frame never resolve
  }

  dismiss() { closeOverlay(props().overlay); }

  // Every close (Esc is Herdr's own). `went`: a row was picked, so the keyboard follows it instead.
  async close() { setShared("emergence.over", { at: Date.now(), open: false, went: this.went }); }

  // The sessions (a tab each, in space order), then the list (lib jumpRows) and the row ↵ goes to first.
  list() {
    const all = panes(), ags = agents(), here = focused()?.tab, sp = spaces();
    const tabs = sp.flatMap((s) => s.tabs.map((tb) => {
      const p = all.find((x) => x.tab === tb.id && x.terminal && x.cwd), mine = ags.filter((a) => a.tab === tb.id);
      const lead = mine.find((a) => a.status === tb.status) ?? mine[0]; // the agent the tab's state is from
      return { kind: "tab", s, tb, cwd: p?.cwd, branch: p?.branch, program: (lead ?? p)?.program, on: lead?.title, here: tb.id === here,
        state: tb.status, who: [...new Set(mine.map((a) => a.program?.name ?? "agent"))].join(" · ") };
    }));
    return jumpRows({ spaces: sp, tabs, wts: this.wts, recent: shared("jump.recent") ?? [], query: this.input.value(), expanded: this.expanded,
      archived: new Set(Object.keys(shared("spaces.archived") ?? {})) });
  }

  go(r, cx) {
    if (!r || r.kind === "label" || r.kind === "repo") return; // a heading only names what's under it
    if (r.kind === "more") { this.expanded.add(r.key); this.sel = null; cx?.notify(); return; }
    this.went = true;
    this.dismiss();
    if (r.kind === "tab" || r.tab) run("tab.select", { id: (r.tab ?? r).tb.id });
    else if (r.kind === "space") run("space.select", { id: r.s.id });
    else if (r.kind === "wt") run("space.new", { folder: r.path, machine: r.machine ?? "" });
    else openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: r.space.id, folder: r.cwd, action: "new", branch: r.branch } });
  }

  render(cx) {
    const t = theme(), l = this.list(), { rows } = l, at = selected(l, this.sel);
    if (rows[at] && rowKey(rows[at]) !== this.scrolled) { this.scrolled = rowKey(rows[at]); this.scroll.scroll_to_item(at); } // it follows its row as the list shifts
    const dim = (x) => div().flex_none().text_size(12).text_color(t.dim).child(x);
    const mark = (p) => (p?.icon ? (p.tint ? svg(p.icon).size(14).text_color(t.muted) : image(p.icon).size(14)) : null);
    // What a session shows at the right: its state and how long (working 2m, needs you 4m), else its agent.
    const state = (r) => {
      const st = r.tb.status, since = st === "working" ? r.tb.working_since : r.tb.changed_at;
      if (r.here) return dim("you're here");
      if (!st) return dim(r.who);
      return h_flex().flex_none().gap(5).items_center().text_size(11.5).text_color(st === "blocked" ? t.blocked : st === "done" ? t.done : t.muted)
        .when(st === "working", (y) => y.child(svg("mods/workspace-chrome/spinner.svg").size(11).text_color(t.working).spin(900)))
        .when(st === "blocked" || st === "done", (y) => y.child(div().size(6).rounded(3).bg(t[st])))
        .child(since ? `${STATE[st]} ${ago(since)}` : STATE[st]);
    };
    // One line: indent, mark, name (and dim words after it), what it's on (cut), then the right-hand note.
    const line = (r, on, icon, name, after, middle, right) => h_flex().h(ROW_H).mx(6).pr(10).pl(10 + (r.depth ?? 0) * INDENT).gap(8).items_center()
      .rounded(6).cursor_pointer().when(on, (x) => x.bg(t.selected)).when(!on, (x) => x.hover((h) => h.bg(t.hover)))
      .child(div().size(14).flex_none().flex().items_center().justify_center().when(Boolean(icon), (x) => x.child(icon)))
      .child(div().flex_none().max_w(260).truncate().text_size(13).text_color(r.dim ? t.dim : t.foreground).when(Boolean(r.here), (x) => x.font_semibold()).child(name))
      .children(after.filter(Boolean).map((a) => dim(a)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(middle ?? ""))
      .when(Boolean(right), (x) => x.child(right));
    const row = (r, i) => {
      const on = i === at;
      if (r.kind === "label") return div().h(24).px(16).pt(8).text_size(11).font_medium().text_color(t.dim).child(r.text);
      if (r.kind === "repo") return line(r, false, null, r.repo, [r.machine, "not open"], null, null);
      if (r.kind === "more") return line(r, on, null, `${r.count} worktrees not open`, [], null, on ? dim("↵ show them") : null);
      if (r.kind === "new") return line(r, on, div().text_size(14).text_color(t.accent).child("+"), "New worktree", [r.branch, `from ${r.repo}`], null, null);
      if (r.kind === "wt") return line(r, on, svg("mods/agent-graph/branch.svg").size(14).text_color(t.muted), r.branch ?? "(detached)",
        [r.repo !== r.branch ? r.repo : null], tilde(r.path), dim(on ? "↵ open as space" : r.at > 0 ? `committed ${ago(r.at)}` : "not open"));
      if (r.kind === "tab") return line(r, on, mark(r.program), r.tb.name, [r.recent && r.s.name !== r.tb.name ? r.s.name : null, r.branch !== r.tb.name ? r.branch : null],
        r.on || tilde(r.cwd), state(r));
      const s = r.tab; // a space: one session's row, or the heading over its sessions
      return line(r, on, s ? mark(s.program) : svg(r.wt && !r.wt.main ? "mods/agent-graph/branch.svg" : "mods/workspace-chrome/folder.svg").size(13).text_color(t.dim),
        r.s.name, [r.wt?.branch, r.s.machine], s ? s.on || "" : "", s ? state(s) : r.here ? dim("you're here") : null);
    };
    const move = (by, cx) => { if (rows.length) this.sel = rowKey(rows[step(rows, at, by)]); cx.stop_propagation(); cx.notify(); };
    return v_flex().id("jump").size_full().bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.dismiss();
        else if (e.key === "down") move(1, cx);
        else if (e.key === "up") move(-1, cx);
      })
      .child(h_flex().h(52).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/workspace-chrome/search.svg").size(16).flex_none().text_color(t.dim))
        .child(Input.new(this.input).id("jump-input").flex_1().h_full().text_size(15).text_color(t.foreground))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(this.input.value().trim() ? `${l.shown} of ${l.total} spaces` : `${l.total} spaces`))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("↑↓ · ↵ go"))
        .child(div().id("jump-esc").flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((x) => x.bg(t.hover).text_color(t.foreground)).on_click(() => this.dismiss()).child("Esc")))
      .child(v_flex().id("jump-list").flex_1().min_h(0).py(6).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map((r, i) => div().id(`jump-${i}`).on_click((_e, cx) => this.go(r, cx)).child(row(r, i))))
        .when(!rows.length, (x) => x.child(div().p(16).text_center().text_size(13).text_color(t.muted).child("Nothing matches."))));
  }
}
