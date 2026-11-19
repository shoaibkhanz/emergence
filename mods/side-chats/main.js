// The sidebar's Side chats, the last section, after Ports: a row per open side chat (mods/side): its harness's mark,
// its label, where it came from and its status, in the inbox's words. A click or Enter shows it in the right panel's
// Side view and gives it the keyboard. lib.js decides; this file draws. It asks the inbox for its height (shared
// side-chats.want, 0 with nothing to show or a folded sidebar) and shares what it got (side-chats.h).
// The keyboard (mod.json focusable): Ctrl-J/K from the inbox and Ports arrive as down/up, and pass straight through
// when there's nothing here; ⌘B's "is it here?" chain runs Spaces → Inbox → Ports → Side chats.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { run, theme, settings, layout, terminals, shared, setShared, nextCommand, focused } from "herdr";
import { holder, listKey } from "./keyboard.js";
import { rowsOf, wantOf, holdsKeys, HEADER_H, ROW_H, EMPTY_H } from "./lib.js";

const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
const RAIL_W = 160; // the sidebar folds to a rail below this width (as the inbox and Ports read it)
const folded = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < RAIL_W || !!find(layout(), "sidebar")?.hidden;
const FOCUS_CHECK_MS = 250; // no blur event: the cursor ring follows the keyboard by polling is_focused
const ROOMY_W = 340; // narrower than this, a row drops "from …" (its tooltip still has it): the label comes first
const STATUS = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };

// Back to the pane the keyboard came from (as Ports' back).
function back() {
  const f = focused();
  if (f) run("pane.focus", f.pane ? { pane: f.pane } : { terminal: f.terminal });
}

// A copy of mods/side/main.js show(slot) with focus, kept identical: the slot in the panel's Side view.
function show(slot) {
  run("layout.show", { id: "panel" });
  run("layout.select", { stack: "panel-body", child: "side" });
  run("layout.select", { stack: "side-slots", child: slot });
  run("layout.show", { id: "side-slots" });
  run("pane.focus", { terminal: slot });
}

export default class SideChats extends View {
  init(_props, cx) {
    this.fh = cx.focus_handle();
    this.kb = holder({ id: "side-chats", panel: false, focus: () => this.fh.focus(), held: () => this.ringed, shown: () => true }); // dialogs give the keyboard back (shared/keyboard.js)
    this.list = ScrollHandle.new();
    this.cur = null; // the cursor's slot
    this.rows = [];
    cx.timer.every(FOCUS_CHECK_MS, (cx) => { if (this.fh.is_focused() !== this.ringed) cx.notify(); });
    cx.timer.every(5000, (cx) => cx.notify()); // a handed-over chat that never started drops out (lib slotView)
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus" || c === "down" || c === "up") {
          if (holdsKeys(this.rows.length, folded())) { this.cur ??= this.rows[0].slot; this.fh.focus(); }
          else if (c === "up") run("ports.up"); // nothing here: on to the section above (the last has none below)
        } else if (c === "toggle") run(this.fh.is_focused() ? "tabs-plus.fold" : "spaces-plus.focus"); // ⌘B: the last
        else if (c === "back") back();
        cx.notify();
      }
    });
  }

  key(k, cx) {
    k = listKey(k, false); // h/j/k/l beside the arrows
    if (k === "ctrl-l" || k === "escape") return back();
    const i = this.rows.findIndex((r) => r.slot === this.cur);
    if (k === "up" || k === "down") {
      const j = Math.max(0, Math.min(this.rows.length - 1, i + (k === "up" ? -1 : 1)));
      this.cur = this.rows[j]?.slot ?? null;
      if (this.cur) this.list.scroll_to_item(j);
    } else if (k === "enter" && i >= 0) show(this.rows[i].slot);
    cx.notify();
  }

  // Shared only on change: every setShared re-renders every mod.
  publish(key, value) {
    if (this[key] === value) return;
    this[key] = value;
    setShared(key, value);
  }

  // The program's mark (programs.json), as the inbox draws it.
  mark(t, p, size) {
    if (!p?.icon) return div().size(size).flex_none().rounded(5).border(1).border_color(t.border);
    if (p.tint && p.tile) return h_flex().size(size).flex_none().rounded(5).bg(p.tile).items_center().justify_center()
      .child(svg(p.icon).size(Math.round(size * 0.66)).text_color(p.color ?? t.foreground));
    return p.tint ? svg(p.icon).size(size).flex_none().text_color(t.foreground) : image(p.icon).w(size).h(size).flex_none().rounded(5);
  }

  status(t, s) {
    const ink = s === "working" ? t.working : s === "blocked" ? t.blocked : s === "done" ? t.done : null;
    return h_flex().flex_none().gap(5).items_center().text_size(11).text_color(s === "idle" ? t.dim : ink)
      .when(s === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).spin(900))) // native: AGENTS.md
      .when(s === "blocked" || s === "done", (el) => el.child(div().size(6).rounded(3).bg(ink)))
      .child(STATUS[s]);
  }

  row(t, r, selected, roomy) {
    return h_flex().id(`side-chat-${r.slot}`).tooltip(r.from ? `${r.label}, from ${r.from}` : r.label).h(ROW_H).px(10).gap(8).flex_none().items_center().rounded(8).cursor_pointer()
      .when(selected, (el) => el.bg(t.selected)).hover((st) => st.bg(t.hover))
      .when(this.ringed && this.cur === r.slot, (el) => el.border_1().border_color(t.accent))
      .on_click(() => { this.cur = r.slot; show(r.slot); })
      .child(this.mark(t, r.program, 14))
      .child(div().when(!roomy, (el) => el.flex_1()).when(roomy, (el) => el.flex_none().max_w(180)).min_w(0).truncate()
        .text_size(12.5).text_color(t.foreground).child(r.label))
      .when(roomy, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(r.from ? `from ${r.from}` : "")))
      .child(this.status(t, r.status));
  }

  render(cx) {
    const t = theme();
    const slots = (find(layout(), "side-slots")?.children ?? []).map((c) => c.id);
    const rows = rowsOf(terminals(), slots, shared("side.tabs") ?? {}, Date.now());
    this.rows = rows;
    if (!rows.some((r) => r.slot === this.cur)) this.cur = rows[0]?.slot ?? null;
    this.kb.tick(cx);
    this.ringed = this.fh.is_focused();
    const hidden = folded();
    if (this.ringed && !holdsKeys(rows.length, hidden)) back(); // its last chat ended, or the sidebar folded, while it had the keys
    this.publish("side-chats.want", wantOf(rows.length, hidden));
    const root = v_flex().id("side-chats").size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_size_change((size) => this.publish("side-chats.h", Math.round(size.height / (settings().zoom ?? 1))))
      .track_focus(this.fh).on_key_down((e, cx) => this.key(e.keystroke, cx));
    if (hidden) return root;
    const label = (extra) => h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
      .child(div().font_medium().child("Side chats")).child(extra);
    if (!rows.length) { // one line, as Ports' "none": where side chats will appear, and the key that makes one
      return root.border_t(1).border_color(t.border)
        .child(h_flex().h(EMPTY_H).flex_none().pl(16).pr(12).items_center().child(label("none · ⌘⌥/")));
    }
    const stack = find(layout(), "side-slots"), shownOnSide = !find(layout(), "panel")?.hidden && find(layout(), "panel-body")?.active === "side";
    return root.border_t(1).border_color(t.border)
      .child(h_flex().h(HEADER_H).pt(10).pl(16).pr(12).flex_none().items_center().child(label(String(rows.length))))
      .child(v_flex().id("side-chats-list").flex_1().min_h(0).px(6).overflow_y_scrollbar().track_scroll(this.list)
        .children(rows.map((r) => this.row(t, r, shownOnSide && stack?.active === r.slot, (find(layout(), "sidebar")?.size?.px ?? 0) >= ROOMY_W))));
  }
}
