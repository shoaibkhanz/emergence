// Side sessions: ⌘⌥/ on an agent's pane opens a copy of that agent's conversation beside it, in the right panel's
// Side view, one tab per side chat (findings and design: docs/superpowers/specs/2026-11-15-side-sessions-*.md, local).
// One mod, three copies:
//   props {resident: true}  a 0px layout block that gets the key commands (a mod hears them only while shown);
//   props {panel: true}     the Side view's header: a tab per live side chat, ✕ to end one;
//   props {view: "harnesses"} the popup choosing which harnesses side sessions work for.
// The copy itself is the harness's own (side.py's adapters); it runs as a named terminal side-N that the layout's
// fixed slot side-N shows, so switching tabs is layout.select (click state), never a layout-file write.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, hc, run, theme, props, nextCommand, focused, panes, agents, knownAgents, notify, openOverlay, closeOverlay,
  appHome, layout, shared, setShared } from "herdr";
import { NAMES, SLOTS, harnessOf, decide, noticeFor, freeSlot, tabsOf } from "./lib.js";

const SUPPORTED = ["claude", "opencode"]; // harnesses with an adapter in side.py; codex, pi and omp come next
const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
// The person's harness switches. Shared, not localStorage: each copy of a mod (key listener, popup) has its own store.
const choices = () => shared("side.harnesses") ?? null;
const say = (n) => n && notify({ ...n, level: "info" });

async function helper(op, req) {
  try {
    const r = await exec("python3", [`${appHome()}/mods/side/side.py`, op, "--json", JSON.stringify(req)], { timeout: 30000 });
    if (r.code !== 0) return { v: 1, error: { code: "helper", message: r.stderr.trim().split("\n").pop() || `side.py exited ${r.code}` } };
    return JSON.parse(r.stdout);
  } catch (e) {
    return { v: 1, error: { code: "helper", message: String(e?.message ?? e) } };
  }
}

// Names of the live side-N terminals.
async function liveSlots() {
  const r = await hc(["ls", "--json"]);
  if (r.code !== 0) return [];
  return (JSON.parse(r.stdout).terminals ?? []).filter((t) => t.state === "live" && SLOTS.includes(t.name)).map((t) => t.name);
}

function show(slot) {
  run("layout.show", { id: "panel" });
  run("layout.select", { stack: "panel-body", child: "side" });
  run("layout.show", { id: "side-slots" });
  run("layout.select", { stack: "side-slots", child: slot });
  run("pane.focus", { terminal: slot });
}

export default class Side extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.view === "harnesses") return this.initChooser(cx);
    if (p.panel) return this.initPanel(cx);
    if (!p.resident) return;
    this.retryAt = shared("side.retry")?.at; // a retry from before this load isn't for us
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "chat") await this.chat();
        else if (c === "harnesses") openOverlay({ mod: "side", props: { view: "harnesses" }, kind: "dialog", width: 440 });
      }
    });
  }

  // ---- the key: copy the focused agent into a new side chat ----
  async chat(retry = false) {
    if (this.busy) return; // a second press while one copy is in flight
    this.busy = true;
    try {
      const f = focused();
      const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
      const agent = pane && agents().find((a) => a.pane === pane.pane);
      const h = harnessOf(pane, agent);
      const installed = Object.fromEntries((await knownAgents().catch(() => [])).map((a) => [a.key, a.installed]));
      const d = decide(h, choices(), installed, SUPPORTED);
      if (d.action === "choose" && !retry) {
        openOverlay({ mod: "side", props: { view: "harnesses", then: "chat" }, kind: "dialog", width: 440 });
        return;
      }
      if (d.action !== "open") return say(d.notice ?? { title: "Choose harnesses first" });
      const pid = JSON.parse((await hc(["get", pane.terminal, "--json"])).stdout || "{}").foreground?.pid;
      const found = await helper("locate", { harness: h, pid, cwd: pane.cwd });
      if (found.error) return say(noticeFor(found, h));
      const made = await helper("copy", { session: found.session, pid, answerOnly: true });
      if (made.error) return say(noticeFor(made, h));
      const label = `${NAMES[h]} · ${(found.session.cwd ?? pane.cwd ?? "").split("/").filter(Boolean).pop()}`; // the folder tells side chats apart; tab names repeat
      if (!(await this.open(made.launch, pane.terminal, h, label))) return;
      say(noticeFor(found, h));
      say(noticeFor(made, h));
    } finally {
      this.busy = false;
    }
  }

  async open(launch, parent, harness, label) {
    if (!find(layout(), "side-slots")) { // a layout without the Side view: a pane on the right
      run("terminal.open", { argv: launch.argv, folder: launch.cwd, place: "right", name: label });
      return true;
    }
    const slot = freeSlot(await liveSlots());
    if (!slot) { say({ title: "Close a side chat first" }); return false; }
    const r = await hc(["run", "--bg", "--json", "--name", slot, "--cwd", launch.cwd, "--parent", parent, "--no-notify",
      "--outlive-parent", "--", ...launch.argv]);
    if (r.code !== 0) { say({ title: "Side chat couldn't start", body: (r.stderr || r.stdout).trim().split("\n").pop() }); return false; }
    setShared("side.tabs", { ...(shared("side.tabs") ?? {}), [slot]: { harness, label } });
    show(slot); // the terminal exists first, then its slot is shown: a slot shown empty doesn't attach later
    return true;
  }

  // ---- the Side view's header ----
  initPanel(cx) {
    this.live = [];
    const refresh = async (cx) => {
      const live = await liveSlots();
      const slots = find(layout(), "side-slots");
      if (!live.length && slots && !slots.hidden) run("layout.hide", { id: "side-slots" }); // never show an empty slot
      else if (live.length && slots && !live.includes(slots.active) && find(layout(), "panel-body")?.active === "side") show(live[0]);
      if (live.join() !== this.live.join()) { this.live = live; cx.notify(); }
    };
    refresh(cx);
    cx.timer.every(2000, (cx) => refresh(cx));
  }

  async end(slot, cx) {
    await hc(["kill", slot]);
    await hc(["rm", slot]);
    const { [slot]: _gone, ...rest } = shared("side.tabs") ?? {};
    setShared("side.tabs", rest);
    this.live = this.live.filter((s) => s !== slot);
    if (this.live.length) show(this.live[0]);
    else run("layout.hide", { id: "side-slots" });
    cx.notify();
  }

  renderPanel(t) {
    const tabs = tabsOf(this.live, shared("side.tabs") ?? {});
    const active = find(layout(), "side-slots")?.active;
    const bar = h_flex().id("side-header").size_full().px(8).gap(4).items_center().bg(t.chrome).border_b_1().border_color(t.border).text_size(12);
    if (!tabs.length) return bar.child(div().px(8).text_color(t.dim).truncate().child("Press ⌘⌥/ on an agent to ask it something on the side"));
    return bar.children(tabs.map(({ slot, label }) => h_flex().id(`tab-${slot}`).h(26).pl(10).pr(4).gap(6).items_center().rounded(6)
      .cursor_pointer().map((el) => slot === active ? el.bg(t.selected).text_color(t.foreground) : el.text_color(t.muted))
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => show(slot))
      .child(div().truncate().max_w(220).child(label))
      .child(div().id(`end-${slot}`).px(4).rounded(4).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.end(slot, cx); }).child("✕"))));
  }

  // ---- which harnesses (first use, or side.harnesses) ----
  initChooser(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.picked = { ...(choices() ?? {}) };
    this.known = null;
    cx.spawn(async (cx) => {
      this.known = Object.fromEntries((await knownAgents().catch(() => [])).map((a) => [a.key, a.installed]));
      cx.notify();
    });
  }

  done(save) {
    const p = props();
    if (save) {
      const known = this.known ?? {};
      setShared("side.harnesses", Object.fromEntries(Object.keys(NAMES).map((h) => [h, !!known[h] && this.picked[h] !== false])));
      if (p.then === "chat") setShared("side.retry", { at: Date.now() });
    }
    closeOverlay(p.overlay);
  }

  renderChooser(t) {
    const known = this.known;
    const row = (h) => {
      const on = !!known?.[h] && this.picked[h] !== false, can = !!known?.[h] && SUPPORTED.includes(h);
      const why = !known ? "…" : !known[h] ? "not installed" : !SUPPORTED.includes(h) ? "coming" : null;
      return h_flex().id(`h-${h}`).h(36).px(12).gap(10).items_center().rounded(6).bg(t.surface).border_1().border_color(t.border)
        .when(can, (el) => el.cursor_pointer().on_click((_e, cx) => { this.picked = { ...this.picked, [h]: !on }; cx.notify(); }))
        .child(div().flex_1().text_color(can ? t.foreground : t.dim).child(NAMES[h]))
        .child(why ? div().text_size(12).text_color(t.dim).child(why)
          : div().w(30).h(18).rounded(9).p(2).bg(on ? t.solid : t.input).child(div().size(14).rounded(7).bg(on ? t.solid_foreground : t.dim)
            .when(on, (el) => el.ml(12))));
    };
    return v_flex().id("side-harnesses").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "enter") { this.done(true); cx.stop_propagation(); } })
      .size_full().p(24).gap(16).rounded(10).bg(t.popover).text_size(13)
      .child(h_flex().h(22).items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Side sessions"))
        .child(div().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child("Open a copy of an agent's conversation beside it. Choose the harnesses it works for."))
      .child(v_flex().gap(6).children(Object.keys(NAMES).map(row)))
      .child(h_flex().justify_end().child(h_flex().id("side-done").h(32).px(14).gap(6).items_center().rounded(8).cursor_pointer()
        .bg(t.solid).text_color(t.solid_foreground).text_size(12).font_medium().hover((s) => s.opacity(0.88))
        .on_click(() => this.done(true)).child("Done").child(div().text_size(11).opacity(0.7).child("↵"))));
  }

  render(cx) {
    const t = theme(), p = props() ?? {};
    if (p.view === "harnesses") return this.renderChooser(t);
    if (p.panel) return this.renderPanel(t);
    const retry = shared("side.retry"); // Done in the chooser opened by a key press: run that press again
    if (p.resident && retry && retry.at !== this.retryAt) { this.retryAt = retry.at; cx.spawn(async () => this.chat(true)); }
    return div();
  }
}
