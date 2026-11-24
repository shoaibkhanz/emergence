// The sidebar's inbox, after T3 Code: a card for every agent waiting on you (blocked, finished, or idle
// for its next prompt); working ones are "Working N", the sidebar's last row (drawn by mods/ports). Settle (Herdr's
// tab.settle) puts a card on the shelf below; Herdr brings it back when its agent needs you again.
// Also sizes Spaces above to its rows. Marks stay still: an endless spin redraws the window every frame.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { subAgents, columnHeight, splitColumn, dragsOf, inboxHeight, HEADER_H, ROW_H, EMPTY_H, LIST_PAD, CARD_GAP, FOOT_H, SHELF_MAX, SHELF_PAD } from "./lib.js";
import { agents, terminals, panes, spaces, machines, keys, run, theme, setAgentOrder, layout, settings, shared, setShared, nextCommand, focused } from "herdr";
import { holder, listKey } from "./keyboard.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width (as in Herdr's own sidebar mods).
const width = () => find(layout(), "sidebar")?.size?.px ?? Infinity;
const narrow = () => width() < 160;

// Back to the pane the keyboard came from (as spaces-plus: pane.go doesn't release a keyboard this mod took).
function back() {
  const f = focused();
  if (f) run("pane.focus", f.pane ? { pane: f.pane } : { terminal: f.terminal });
}

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
const PORTS_FALLBACK = 64; // Ports' empty height ("Ports none" + Working) until it says what it needs
const MISMATCH_MS = 300; // a section still not drawn at its size this long after: the column can't hold it (fitSpaces)
const RANK = { blocked: 0, done: 1, idle: 2 };

export default class Inbox extends View {
  init(_props, cx) {
    this.shelf = true; // the Settled shelf is open
    cx.timer.every(30000, (cx) => cx.notify()); // the ages
    // The keyboard (mod.json focusable), as in spaces-plus; toggle is ⌘B's question "is it here?".
    this.fh = cx.focus_handle();
    this.kb = holder({ id: "inbox", panel: false, focus: () => this.fh.focus(), held: () => this.fh.is_focused() }); // dialogs give the keyboard back (shared/keyboard.js)
    this.cur = null; // the cursor's agent address
    this.list = ScrollHandle.new();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.fh.focus();
        else if (c === "toggle") run(this.fh.is_focused() ? "tabs-plus.fold" : "ports.toggle"); // then Ports, then Side chats, asks the same
        else if (c === "back") back(); // ctrl-l (keys.json mod:inbox: a binding beats on_key_down)
        cx.notify();
      }
    });
    cx.timer.every(250, (cx) => { if (this.fh.is_focused() !== this.ringed) cx.notify(); }); // no blur event
  }

  key(k, cx) {
    k = listKey(k); // h/j/k/l beside the arrows
    if (k === "ctrl-k") return run("spaces-plus.focus");
    if (k === "ctrl-l" || k === "escape") return back();
    const i = this.cards.findIndex((a) => a.address === this.cur);
    if (k === "up" || k === "down") {
      const j = Math.max(0, Math.min(this.cards.length - 1, i + (k === "up" ? -1 : 1)));
      this.cur = this.cards[j]?.address ?? null;
      if (this.cur) this.list.scroll_to_item(j);
    } else if (k === "enter" && i >= 0) this.go(this.cards[i]);
    cx.notify();
  }

  // The Agents graph rings where this cursor is (agent-graph lib's ringed): shared only while this list has the
  // keyboard, and only when it changes (setShared writes to disk and redraws every mod).
  shareCursor(key, value) {
    const k = JSON.stringify(value);
    if (k === this.cursorShared) return;
    this.cursorShared = k;
    setShared(key, value && { ...value, at: Date.now() });
  }

  // To an agent: its tab (pane.focus releases our keyboard), or a sub-agent's terminal peeked over the tab (it has none).
  go(a) {
    if (a.sub) run("terminal.peek", { terminal: a.address });
    else { run("agent.focus", { terminal: a.address }); run("pane.focus", { terminal: a.address }); }
  }

  // The column is shared by Spaces, this inbox, Side chats and Ports (lib.js splitColumn): Side chats exactly what its
  // rows need (side-chats.want); Spaces the height its rows ask for (spaces.want) while the inbox's content still fits;
  // Ports what its rows need (ports.want) plus the slack under the inbox's cards, so Working stays last.
  fitSpaces(cx, collapsed, need) {
    const ms = machines().length, sp = find(layout(), "spaces"), po = find(layout(), "ports"), sc = find(layout(), "side-chats");
    if (!sp || sp.hidden) return;
    const spacesWant = shared("spaces.want") ?? 45 + (Math.max(spaces().length, 1) + (ms > 1 ? ms : 0)) * (collapsed ? 26 : 30);
    const portsMin = po ? shared("ports.want") ?? PORTS_FALLBACK : 0;
    const sideWant = sc ? shared("side-chats.want") ?? 0 : 0;
    // What they share: this block's height plus Spaces', Side chats' and Ports' as drawn (lib columnHeight); none while one
    // of them hasn't drawn its new size yet: the next pass fits. The same mismatch MISMATCH_MS on isn't on its way (the
    // column can't hold what was asked): it's taken as drawn. A look is booked then, as nothing else may redraw.
    // A section the person dragged keeps that size (shared sidebar.sized; lib dragsOf tells a drag from our own resize).
    const sections = [[sp, "spaces"], [sc, "side-chats"], [po, "ports"]].filter(([n]) => n && !n.hidden);
    if (!collapsed) {
      const d = dragsOf(this.sent ?? {}, Object.fromEntries(sections.map(([n, id]) => [id, n.size?.px ?? 0])));
      this.sent = d.sent;
      if (Object.keys(d.drags).length) setShared("sidebar.sized", { ...(shared("sidebar.sized") ?? {}), ...d.drags });
    }
    const block = (n, key) => ({ px: n.size?.px ?? 0, shown: shared(key) ?? undefined });
    const blocks = [[sp, "spaces.h"], [sc, "side-chats.h"], [po, "ports.h"]].filter(([n]) => n && !n.hidden).map(([n, k]) => block(n, k));
    const sig = JSON.stringify(blocks);
    if (this.mismatch?.sig !== sig) this.mismatch = null;
    const H = columnHeight(this.ownH, blocks, Boolean(this.mismatch) && Date.now() - this.mismatch.at >= MISMATCH_MS);
    if (H === null) {
      if (!this.mismatch) { this.mismatch = { sig, at: Date.now() }; cx.timer.after(MISMATCH_MS + 50, (cx) => cx.notify()); }
      return;
    }
    this.mismatch = null;
    const sized = shared("sidebar.sized") ?? {};
    const { spaces: px, side, ports } = splitColumn({ H, spacesWant, need, portsMin, sideWant, collapsed, sized });
    // Against the layout's own sizes, not the last ones sent: a size changed from elsewhere is put back (a drag was
    // saved above, so it comes back as itself). Each send is noted for dragsOf.
    const resize = (n, id, to) => {
      if (!n || to === n.size?.px) return;
      run("layout.resize", { id, px: to });
      this.sent = { ...this.sent, [id]: { px: to, from: n.size?.px ?? 0, applied: false } };
    };
    resize(sp, "spaces", px);
    resize(po, "ports", ports);
    resize(sc, "side-chats", side);
  }

  // This block's own height, measured after every layout pass (fitSpaces adds Spaces' and Ports').
  measured(el) {
    return el.on_size_change((size, cx) => {
      const h = Math.round(size.height / (settings().zoom ?? 1));
      if (h !== this.ownH) { this.ownH = h; cx.notify(); }
    });
  }

  // The program's mark (programs.json): its glyph on its own colored tile where it has one, else its icon.
  mark(t, p, size) {
    if (!p?.icon) return div().size(size).flex_none().rounded(5).border(1).border_color(t.border);
    if (p.tint && p.tile) return h_flex().size(size).flex_none().rounded(5).bg(p.tile).items_center().justify_center()
      .child(svg(p.icon).size(Math.round(size * 0.66)).text_color(p.color ?? t.foreground));
    return p.tint ? svg(p.icon).size(size).flex_none().text_color(t.foreground) : image(p.icon).w(size).h(size).flex_none().rounded(5);
  }

  // A two-line row: the program's mark, its branch (else its folder) and Needs you or its age (Settle on
  // hover); under it the task.
  card(t, a, tab, pane, now) {
    const over = this.hovered === a.address;
    const settle = div().id(`settle-${a.address}`).h(18).px(6).gap(4).flex().flex_none().items_center().rounded(5)
      .border(1).border_color(t.border).text_size(11).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Put it away until its agent needs you again")
      .on_click((_e, cx) => { cx.stop_propagation(); run("tab.settle", { id: a.tab }); this.hovered = null; cx.notify(); })
      .child(svg("mods/workspace-chrome/check.svg").size(11)).child("Settle");
    return v_flex().id(`card-${a.address}`).px(10).py(7).gap(2).flex_none().rounded(8).cursor_pointer()
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .when(this.ringed && this.cur === a.address, (el) => el.border_1().border_color(t.accent))
      .on_hover((on, cx) => { if (on) this.hovered = a.address; else if (this.hovered === a.address) this.hovered = null; cx.notify(); })
      .on_click(() => this.go(a))
      .child(h_flex().h(18).gap(6).items_center()
        .child(this.mark(t, a.program, 14))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(pane?.branch || pane?.cwd?.split("/").filter(Boolean).pop() || a.space_name))
        .child(a.status === "blocked"
          ? div().flex_none().text_size(11).font_medium().text_color(t.blocked).child("Needs you")
          : over ? settle : div().flex_none().text_size(11).text_color(t.dim).child(tab?.changed_at ? ago(now - tab.changed_at) : "")))
      .child(div().pl(20).truncate().text_size(12).text_color(t.muted).child(task(a, tab)));
  }

  // A quiet row at the foot: the Settled shelf's header.
  foot(t, id, icon, label, n, onClick, open) {
    return h_flex().id(id).h(FOOT_H).px(16).gap(8).flex_none().items_center().text_size(12).text_color(t.muted).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).on_click(onClick)
      .child(icon).child(label).child(div().text_size(11).text_color(t.dim).child(String(n))).child(div().flex_1())
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).text_color(t.dim));
  }

  render(cx) {
    const t = theme();
    const collapsed = narrow();
    const now = Date.now();
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const parent = new Map(terminals().map((x) => [x.address, x.parent]));
    const pane = new Map(panes().map((p) => [p.pane, p]));
    const tabbed = agents(), all = [...tabbed, ...subAgents(terminals(), new Set(tabbed.map((a) => a.address)))]; // + sub-agents (no tab)
    // Waiting on you: blocked anywhere, else finished or idle where the tab isn't settled. A sub-agent's
    // finish is its parent's news. Blocked first, then done, then idle; the newest first in each.
    const cards = all.filter((a) => a.status === "blocked" || (RANK[a.status] !== undefined && !tabs.get(a.tab)?.settled && !parent.get(a.address)))
      .sort((x, y) => RANK[x.status] - RANK[y.status] || (tabs.get(y.tab)?.changed_at ?? 0) - (tabs.get(x.tab)?.changed_at ?? 0));
    // The cursor stays on its agent; when that card goes (answered, settled) it takes the card now in its place.
    let i = cards.findIndex((a) => a.address === this.cur);
    if (i < 0) i = Math.min(this.curI ?? 0, cards.length - 1);
    this.cards = cards;
    this.cur = cards[i]?.address ?? null;
    this.curI = Math.max(i, 0);
    this.kb.tick(cx);
    this.ringed = this.fh.is_focused();
    this.shareCursor("inbox.cursor", this.ringed && this.cur ? { kind: "agent", id: this.cur } : null);
    if (!cards.some((a) => a.address === this.hovered)) this.hovered = null; // gone without a hover-out
    setAgentOrder([...cards, ...all.filter((a) => !cards.includes(a))].map((a) => a.address)); // ⌘] / ⌘[ walk the inbox first
    const settled = [...tabs.values()].filter((tab) => tab.settled).sort((x, y) => (y.settled_at ?? 0) - (x.settled_at ?? 0));
    const lead = (tab) => all.find((a) => a.tab === tab.id && !parent.get(a.address));
    const root = v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .track_focus(this.fh).on_key_down((e, cx) => this.key(e.keystroke, cx));

    // Folded (⌘B, ⌘⌥B): only how many need you, at the foot: a badge on the rail, the number on the dots size.
    if (collapsed) {
      this.fitSpaces(cx, collapsed, 40);
      const dots = width() < 34;
      return this.measured(root.id("inbox-folded").justify_end().items_center().pb(12))
        .when(cards.length > 0, (el) => el.child(h_flex().id("inbox-badge").flex_none().justify_center().items_center().cursor_pointer()
          .tooltip(`${cards.length} in the inbox. Open the sidebar`).on_click(() => run("tabs-plus.rail"))
          .when(!dots, (b) => b.size(22).rounded(11).bg(t.blocked).text_size(11).font_semibold().text_color(t.chrome))
          .when(dots, (b) => b.text_size(10).font_semibold().text_color(t.blocked))
          .child(String(cards.length))));
    }
    // Header, the list's content (cards are alike: one is measured), the feet and the open shelf.
    this.fitSpaces(cx, collapsed, inboxHeight({ cards: cards.length, cardH: this.cardH, settled: settled.length, shelf: this.shelf }));
    const bound = keys().find((k) => k.action === "tabs-plus.attention")?.keys;
    // Header and inset line up with Herdr's Spaces list above (16px, 11.5px label).
    return this.measured(root.id("inbox").border_t(1).border_color(t.border)) // the id: on_size_change needs one
      .child(h_flex().h(HEADER_H).pt(10).pl(16).pr(12).gap(6).flex_none().items_center().text_size(11.5).text_color(t.dim)
        .child(div().font_medium().child("Inbox"))
        .when(cards.length > 0, (el) => el.child(String(cards.length)))
        .child(div().flex_1())
        .when(Boolean(bound), (el) => el.child(div().id("inbox-key").h(18).px(5).flex().items_center().rounded(4).border(1).border_color(t.border)
          .text_size(11).tooltip("Next agent that needs you")
          .child(bound.split("-").map((p) => GLYPH[p] ?? p.toUpperCase()).join("")))))
      .child(v_flex().id("inbox-list").flex_1().min_h(0).px(6).pb(LIST_PAD).gap(CARD_GAP).overflow_y_scrollbar().track_scroll(this.list)
        .when(cards.length === 0, (el) => el.child(h_flex().h(EMPTY_H).flex_none().px(10).gap(8).items_center().text_size(12).text_color(t.dim)
          .child(svg("mods/workspace-chrome/circle-check.svg").size(14).flex_none()).child("All caught up")))
        .children(cards.map((a, n) => this.card(t, a, tabs.get(a.tab), pane.get(a.pane), now)
          .when(n === 0, (el) => el.on_size_change((size, cx) => { const h = Math.round(size.height / (settings().zoom ?? 1)); if (h !== this.cardH) { this.cardH = h; cx.notify(); } })))))
      .when(settled.length > 0, (el) => el
        .child(this.foot(t, "inbox-settled", svg("mods/workspace-chrome/archive.svg").size(12), "Settled", settled.length,
          (_e, cx) => { this.shelf = !this.shelf; cx.notify(); }, this.shelf))
        .when(this.shelf, (el) => el.child(v_flex().id("inbox-shelf").flex_none().max_h(SHELF_MAX).px(6).pb(SHELF_PAD).overflow_y_scrollbar()
          .children(settled.map((tab) => {
            const a = lead(tab);
            return h_flex().id(`shelf-${tab.id}`).h(ROW_H).px(10).gap(8).flex_none().items_center().rounded(8).cursor_pointer()
              .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip("Bring it back").on_click(() => run("tab.select", { id: tab.id }))
              .child(this.mark(t, a?.program, 14))
              .child(div().flex_1().min_w(0).truncate().child(task(a, tab) || tab.name))
              .child(div().flex_none().text_size(11).text_color(t.dim).child(tab.settled_at ? ago(now - tab.settled_at) : ""));
          })))));
  }
}
