// The sidebar's inbox, after T3 Code: a card for every agent waiting on you (blocked, finished, or idle
// for its next prompt); working ones are one "Working N" row that opens the agent graph. Settle (Herdr's
// tab.settle) puts a card on the shelf below; Herdr brings it back when its agent needs you again.
// Also sizes Spaces above to its rows. Marks stay still: an endless spin redraws the window every frame.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, machines, keys, run, theme, setAgentOrder, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width (as in Herdr's own sidebar mods).
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Harness marks off a title ("π > ⁂Fix the build" → "Fix the build"); the same as agent-graph/lib.js cleanTitle.
const clean = (s) =>
  (s ?? "").replace(/^(?:[^\p{L}\p{N}\p{Ps}~/]+|\p{L}{1,2}\s*>\s*|\p{L}{1,2}\s+(?=[\p{S}\p{Co}\u2042]))+/u, "")
    .replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFF}]/gu, "").replace(/\s+/g, " ").trim();

// What the agent is on: a tab someone named, else its own title when that says more than its name or a path.
function task(a, tab) {
  const p = a?.program;
  if (tab?.named && tab.name !== p?.name) return tab.name;
  const t = clean(a?.title);
  return t && t !== p?.name && t.toLowerCase() !== p?.key && !/^[~/]/.test(t) && !t.includes("@") ? t : p?.name ?? tab?.name ?? "";
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

const GLYPH = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };
const RANK = { blocked: 0, done: 1, idle: 2 };
const WORD = { blocked: "Needs you", done: "Done" };

export default class Inbox extends View {
  init(_props, cx) {
    this.shelf = true; // the Settled shelf is open
    cx.timer.every(30000, (cx) => cx.notify()); // the ages
  }

  // Spaces gets the height its rows ask for (header and padding 45, a row 30, 26 on the rail, a header
  // per machine once there are several; 8 rows at most, then it scrolls), this list the rest.
  fitSpaces(collapsed) {
    const ms = machines().length;
    const px = 45 + Math.min(Math.max(spaces().length, 1) + (ms > 1 ? ms : 0), 8) * (collapsed ? 26 : 30);
    if (px === this.spacesPx) return;
    this.spacesPx = px;
    if (find(layout(), "spaces")) run("layout.resize", { id: "spaces", px });
  }

  // The program's mark (programs.json): its glyph on its own colored tile where it has one, else its icon.
  mark(t, p, size) {
    if (!p?.icon) return div().size(size).flex_none().rounded(5).border(1).border_color(t.border);
    if (p.tint && p.tile) return h_flex().size(size).flex_none().rounded(5).bg(p.tile).items_center().justify_center()
      .child(svg(p.icon).size(Math.round(size * 0.66)).text_color(p.color ?? t.foreground));
    return p.tint ? svg(p.icon).size(size).flex_none().text_color(t.foreground) : image(p.icon).w(size).h(size).flex_none().rounded(5);
  }

  // A T3-style card: program and where (its folder; its space once agents span spaces), the task, the
  // branch; on hover, Settle where the age was.
  card(t, a, tab, pane, now, manySpaces) {
    const over = this.hovered === a.address;
    const settle = div().id(`settle-${a.address}`).h(18).px(6).gap(4).flex().flex_none().items_center().rounded(5)
      .border(1).border_color(t.border).text_size(11).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Put it away until its agent needs you again")
      .on_click((_e, cx) => { cx.stop_propagation(); run("tab.settle", { id: a.tab }); this.hovered = null; cx.notify(); })
      .child(svg("mods/workspace-chrome/check.svg").size(11)).child("Settle");
    return v_flex().id(`card-${a.address}`).px(10).py(8).gap(3).flex_none().rounded(8).cursor_pointer()
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => { if (on) this.hovered = a.address; else if (this.hovered === a.address) this.hovered = null; cx.notify(); })
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(h_flex().h(18).gap(6).items_center().text_size(11).text_color(t.dim)
        .child(this.mark(t, a.program, 14))
        .child(div().flex_1().min_w(0).truncate().child(manySpaces ? a.space_name : pane?.cwd?.split("/").filter(Boolean).pop() ?? a.space_name))
        .child(a.status === "blocked"
          ? h_flex().h(18).px(6).gap(4).flex_none().items_center().rounded(5).bg(t.blocked + "26").text_size(11).font_semibold().text_color(t.blocked).child("!").child("Needs you")
          : over ? settle : div().flex_none().child(tab?.changed_at ? ago(now - tab.changed_at) : "")))
      .child(div().truncate().text_size(13).text_color(t.foreground).child(task(a, tab)))
      .child(h_flex().h(16).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).font_family("Geist Mono").text_color(t.dim).child(pane?.branch ?? ""))
        .when(a.status === "done", (el) => el.child(svg("mods/workspace-chrome/check.svg").size(13).flex_none().text_color(t.done))));
  }

  // A quiet row at the foot: Working (opens the graph) and the Settled shelf's header.
  foot(t, id, icon, label, n, onClick, open) {
    return h_flex().id(id).h(32).px(16).gap(8).flex_none().items_center().text_size(12).text_color(t.muted).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click(onClick)
      .child(icon).child(label).child(div().text_size(11).text_color(t.dim).child(String(n))).child(div().flex_1())
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).text_color(t.dim));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    this.fitSpaces(collapsed);
    const now = Date.now();
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const parent = new Map(terminals().map((x) => [x.address, x.parent]));
    const pane = new Map(panes().map((p) => [p.pane, p]));
    const all = agents();
    // Waiting on you: blocked anywhere, else finished or idle where the tab isn't settled. A sub-agent's
    // finish is its parent's news. Blocked first, then done, then idle; the newest first in each.
    const cards = all.filter((a) => a.status === "blocked" || (RANK[a.status] !== undefined && !tabs.get(a.tab)?.settled && !parent.get(a.address)))
      .sort((x, y) => RANK[x.status] - RANK[y.status] || (tabs.get(y.tab)?.changed_at ?? 0) - (tabs.get(x.tab)?.changed_at ?? 0));
    const manySpaces = new Set(cards.map((a) => a.space)).size > 1;
    if (!cards.some((a) => a.address === this.hovered)) this.hovered = null; // gone without a hover-out
    setAgentOrder([...cards, ...all.filter((a) => !cards.includes(a))].map((a) => a.address)); // ⌘] / ⌘[ walk the inbox first
    const working = all.filter((a) => a.status === "working").length;
    const settled = [...tabs.values()].filter((tab) => tab.settled).sort((x, y) => (y.settled_at ?? 0) - (x.settled_at ?? 0));
    const lead = (tab) => all.find((a) => a.tab === tab.id && !parent.get(a.address));
    const root = v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13);

    // Folded (⌘B): a short line per agent that needs you, nothing else (lines, not dots: macOS's window
    // buttons are red, yellow and green dots right beside it). A line goes to its agent; anywhere else unfolds.
    if (collapsed) {
      return v_flex().id("inbox-strip").size_full().pt(find(layout(), "brand")?.hidden ? 48 : 8).gap(2).items_center().bg(t.chrome).cursor_pointer()
        .tooltip("Unfold the sidebar").on_click(() => run("tabs-plus.rail"))
        .children(cards.filter((a) => a.status !== "idle").map((a) => h_flex().id(`mark-${a.address}`).w_full().h(22).flex_none().justify_center().items_center()
          .tooltip(`${task(a, tabs.get(a.tab))} · ${WORD[a.status]}`)
          .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: a.address }); })
          .child(div().w(3).h(16).rounded(2).bg(t[a.status]))));
    }
    const bound = keys().find((k) => k.action === "tabs-plus.attention")?.keys;
    // Header and inset line up with Herdr's Spaces list above (16px, 11.5px label).
    return root
      .child(h_flex().h(41).pt(10).pl(16).pr(12).gap(6).flex_none().items_center().text_size(11.5).text_color(t.dim)
        .child(div().font_medium().child("Inbox"))
        .when(cards.length > 0, (el) => el.child(String(cards.length)))
        .child(div().flex_1())
        .when(Boolean(bound), (el) => el.child(div().id("inbox-key").h(18).px(5).flex().items_center().rounded(4).border(1).border_color(t.border)
          .text_size(11).tooltip("Next agent that needs you")
          .child(bound.split("-").map((p) => GLYPH[p] ?? p.toUpperCase()).join("")))))
      .child(v_flex().id("inbox-list").flex_1().min_h(0).px(6).gap(2).overflow_y_scrollbar()
        .when(cards.length === 0, (el) => el.child(h_flex().h(32).px(10).gap(8).items_center().text_size(12).text_color(t.dim)
          .child(svg("mods/workspace-chrome/circle-check.svg").size(14).flex_none()).child("All caught up")))
        .children(cards.map((a) => this.card(t, a, tabs.get(a.tab), pane.get(a.pane), now, manySpaces))))
      .when(working > 0, (el) => el.child(this.foot(t, "inbox-working", svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working), "Working", working,
        () => { if (find(layout(), "panel")?.hidden || find(layout(), "panel-body")?.active !== "graph") run("tabs-plus.graph"); }, false)
        .tooltip("Open the agent graph")))
      .when(settled.length > 0, (el) => el
        .child(this.foot(t, "inbox-settled", svg("mods/workspace-chrome/archive.svg").size(12), "Settled", settled.length,
          (_e, cx) => { this.shelf = !this.shelf; cx.notify(); }, this.shelf))
        .when(this.shelf, (el) => el.child(v_flex().id("inbox-shelf").flex_none().max_h(160).px(6).pb(6).overflow_y_scrollbar()
          .children(settled.map((tab) => {
            const a = lead(tab);
            return h_flex().id(`shelf-${tab.id}`).h(30).px(10).gap(8).flex_none().items_center().rounded(8).cursor_pointer()
              .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip("Bring it back").on_click(() => run("tab.select", { id: tab.id }))
              .child(this.mark(t, a?.program, 14))
              .child(div().flex_1().min_w(0).truncate().child(task(a, tab) || tab.name))
              .child(div().flex_none().text_size(11).text_color(t.dim).child(tab.settled_at ? ago(now - tab.settled_at) : ""));
          })))));
  }
}
