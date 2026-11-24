// Side sessions: ⌘⌥/ on an agent's pane opens a side chat beside it that has the agent's conversation as background
// (Claude, pi, omp: a fresh session; OpenCode: a read-only fork shown without its history), in the right panel's Side view,
// one tab per side chat (findings and design: docs/superpowers/specs/2026-11-15-side-sessions-*.md, local).
// One mod, three copies:
//   props {resident: true}  a 0px layout block that gets the key commands (a mod hears them only while shown);
//   props {panel: true}     the Side view's header: a tab per open side chat, ✕ to end one;
//   props {view: "harnesses"} the popup choosing which harnesses side sessions work for.
// The copy itself is the harness's own (side.py's adapters). It runs in a slot: a terminal side-N that the layout's
// fixed block side-N shows, hosting one chat after another (host.py) and never ending, because Herdr deletes a block
// whose terminal is finished from the layout file, and emergence.json is the repo's. Switching tabs is layout.select
// (click state), never a layout-file write. One idle host is kept warm, so a key press shows its slot at once
// ("Opening a side chat…") while the helper finds the session and the agent loads.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, hc, run, theme, props, nextCommand, focused, panes, agents, terminals, spaces, knownAgents, notify,
  openOverlay, closeOverlay, appHome, home, layout, shared, setShared } from "herdr";
import { NAMES, harnessOf, decide, noticeFor, tabsOf, started, claim, bannerOf, withoutTab, INTRO, withoutStarting, withoutStale, sideFrame } from "./lib.js";
import { slotView } from "./slots.js";

const SUPPORTED = ["claude", "opencode", "pi", "omp"]; // harnesses with an adapter in side.py; codex comes next
const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
// The person's harness switches: only the ones they flipped (never switched = on). Shared, not localStorage: each copy
// of a mod (key listener, popup) has its own store.
const choices = () => shared("side.harnesses") ?? null;
const say = (n, level = "info") => n && notify({ ...n, level });
const warn = (n) => say(n, "warning");
const py = (file, args, timeout = 30000) => exec("python3", ["-B", `${appHome()}/mods/side/${file}`, ...args], { timeout });
const SLOT_DIR = () => `${appHome()}/data/side/slots`;
const layoutSlots = () => (find(layout(), "side-slots")?.children ?? []).map((c) => c.id);
const view = () => slotView(terminals(), layoutSlots(), shared("side.tabs") ?? {}, Date.now());
const WATCHED_MS = 6000; // the header redraws at least every 5 s while shown (init's timer)
const starting = {}; // slot -> when its host's start began (lib withoutStarting); one resident copy starts hosts

async function helper(op, req) {
  try {
    const r = await py("side.py", [op, "--json", JSON.stringify(req)]);
    if (r.code !== 0) return { v: 1, error: { code: "helper", message: r.stderr.trim().split("\n").pop() || `side.py exited ${r.code}` } };
    return JSON.parse(r.stdout);
  } catch (e) {
    return { v: 1, error: { code: "helper", message: String(e?.message ?? e) } };
  }
}

// Show a slot in the panel; `focus` gives it the keyboard (a person's choice, not an automatic move).
function show(slot, focus = true) {
  run("layout.show", { id: "panel" });
  run("layout.select", { stack: "panel-body", child: "side" });
  run("layout.select", { stack: "side-slots", child: slot });
  run("layout.show", { id: "side-slots" });
  if (focus) run("pane.focus", { terminal: slot });
}

export default class Side extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.view === "harnesses") return this.initChooser(cx);
    if (p.panel) return cx.timer.every(5000, (cx) => cx.notify()); // a handed-over chat that never started drops out
    if (!p.resident) return;
    this.retryAt = shared("side.retry")?.at; // a retry from before this load isn't for us
    const saved = choices(), kept = withoutStale(saved, SUPPORTED); // the first chooser's leftovers go (lib withoutStale)
    if (JSON.stringify(kept) !== JSON.stringify(saved)) setShared("side.harnesses", kept);
    // Emergence settings draws these switches too, and mods can't import each other.
    const offer = { names: NAMES, supported: SUPPORTED };
    if (JSON.stringify(shared("side.supported")) !== JSON.stringify(offer)) setShared("side.supported", offer);
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "chat") this.press(false);
        else if (c === "harnesses") openOverlay({ mod: "side", props: { view: "harnesses" }, kind: "dialog", width: 440 });
      }
    });
  }

  // Not awaited by the command loop, so a second press during a copy finds busy set; a throw never kills the loop.
  press(retry) {
    this.chat(retry).catch((e) => warn({ title: "Side chat couldn't start", body: String(e?.message ?? e) }));
  }

  // ---- the key: a side chat for the focused agent ----
  async chat(retry) {
    if (this.busy) return say({ title: "A side chat is already opening" });
    this.busy = true;
    let shown = null, ok = false; // a warm slot shown before the helper ran is dropped again if the press fails
    try {
      const f = focused();
      const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
      const agent = pane && agents().find((a) => a.pane === pane.pane);
      const h = harnessOf(pane, agent);
      if (h && spaces().find((s) => s.id === f.space)?.machine) return say({ title: "Side chat works on this computer's agents" });
      const d = decide(h, choices(), { [h]: true }, SUPPORTED); // a running agent's harness is installed: no knownAgents wait
      if (d.action === "choose" && !retry) {
        openOverlay({ mod: "side", props: { view: "harnesses", then: "chat" }, kind: "dialog", width: 440 });
        return;
      }
      if (d.action !== "open") return say(d.notice ?? { title: "Choose harnesses first" });
      const slotted = !!find(layout(), "side-slots");
      await this.warming; // a host being started for a slot must not be started twice
      const spot = slotted ? claim(withoutStarting(view(), starting, Date.now())) : null; // before any copy: a copy with nowhere to go would be left behind
      if (slotted && !spot) return say({ title: "Close a side chat first" });
      const label = `${NAMES[h]} · ${(pane.cwd ?? "").split("/").filter(Boolean).pop()}`; // folders tell chats apart; tab names repeat
      const from = pane.branch || agent?.tab_name || null; // as the inbox names an agent
      if (spot && !spot.create) { this.tab(spot.slot, h, label, from); show(spot.slot); shown = spot.slot; } // at once: its host is warm
      const pid = terminals().find((t) => t.address === pane.terminal)?.foreground?.pid;
      const found = await helper("locate", { harness: h, pid, cwd: pane.cwd });
      if (found.error) return warn(noticeFor(found, h));
      const made = await helper("copy", { session: found.session, pid, answerOnly: true, dataDir: `${appHome()}/data/side` });
      if (made.error) return warn(noticeFor(made, h));
      if (!slotted) run("terminal.open", { argv: made.launch.argv, folder: made.launch.cwd, place: "right", name: `${NAMES[h]} · side` });
      else if (!(await this.start(spot, made.launch, h, label, from))) return;
      ok = true;
      say(noticeFor(found, h));
      say(noticeFor(made, h));
    } finally {
      if (shown && !ok) setShared("side.tabs", withoutTab(shared("side.tabs") ?? {}, shown)); // the panel moves off it
      this.busy = false;
      this.warm(); // the next press's slot
    }
  }

  // What the panel and the sidebar show for a slot; its time keeps it open until its agent has started (lib slotView).
  tab(slot, harness, label, from) {
    setShared("side.tabs", { ...(shared("side.tabs") ?? {}), [slot]: { harness, label, from, at: Date.now() } });
  }

  // A slot's host: its terminal runs host.py, which never ends (the slot's layout block depends on it).
  async host(slot) {
    starting[slot] = Date.now();
    const r = await hc(["run", "--bg", "--name", slot, "--cwd", home(), "--no-parent", "--no-notify", "--",
      "python3", "-B", `${appHome()}/mods/side/host.py`, "serve", slot, SLOT_DIR()]);
    if (r.code !== 0) warn({ title: "Side chat couldn't start", body: (r.stderr || r.stdout).trim().split("\n").pop() });
    return r.code === 0;
  }

  // Keep one idle host ready, so the next key press shows its slot at once (its terminal exists before it's shown).
  warm() {
    if (this.warming || this.busy || !find(layout(), "side-slots")) return; // a press claims its own slot
    const v = withoutStarting(view(), starting, Date.now());
    if (v.idle.length || !v.missing.length) return;
    this.warming = this.host(v.missing[0]).catch(() => false).finally(() => { this.warming = null; });
  }

  // Hand the chat to its slot's host (starting the host first when none was warm).
  async start({ slot, create }, launch, harness, label, from) {
    if (create && !(await this.host(slot))) return false;
    const r = await py("host.py", ["send", slot, SLOT_DIR(), JSON.stringify({ argv: launch.argv, cwd: launch.cwd, intro: INTRO })]);
    if (r.code !== 0) { warn({ title: "Side chat couldn't start", body: r.stderr.trim().split("\n").pop() }); return false; }
    if (create) { // a block shown before its terminal existed stays blank until shown again (findings §3)
      this.tab(slot, harness, label, from);
      show(slot);
      run("layout.hide", { id: "side-slots" });
      await exec("sleep", ["0.3"]);
      show(slot);
    }
    return true;
  }

  // ---- the Side view's header ----
  // ✕ ends the chat, never the slot's terminal (host.py). The last one closes the panel.
  async end(slot, open) {
    setShared("side.tabs", withoutTab(shared("side.tabs") ?? {}, slot));
    const others = open.filter((s) => s !== slot);
    if (others.length) show(others[0]);
    else { run("layout.hide", { id: "side-slots" }); run("layout.hide", { id: "panel" }); }
    await py("host.py", ["stop", slot, SLOT_DIR()]);
  }

  renderPanel(t) {
    const marked = started(shared("side.tabs") ?? {}, terminals()); // a running chat: its end closes the panel at once
    if (marked) setShared("side.tabs", marked);
    const { open } = view(), stack = find(layout(), "side-slots"), now = Date.now();
    const onSide = !find(layout(), "panel")?.hidden && find(layout(), "panel-body")?.active === "side";
    // Never show an idle slot: a chat that ended by itself (/exit, Ctrl-D) moves to another open one, or closes the
    // panel as ✕ does; the view opened with none keeps its hint (lib sideFrame). Watched: open on a recent frame here.
    const watched = this.seen?.slot === stack?.active && now - this.seen.at < WATCHED_MS;
    this.seen = onSide && open.includes(stack?.active) ? { slot: stack.active, at: now } : null;
    const d = stack && onSide ? sideFrame({ open, active: stack.active, hidden: stack.hidden, watched }) : null;
    if (d?.show) show(d.show, false);
    else if (d?.close) { run("layout.hide", { id: "side-slots" }); if (d.close === "panel") run("layout.hide", { id: "panel" }); }
    const tabs = tabsOf(open, shared("side.tabs") ?? {});
    const bar = h_flex().id("side-header").size_full().px(8).gap(4).items_center().bg(t.chrome).border_b_1().border_color(t.border).text_size(12);
    if (!tabs.length) return bar.child(div().px(8).text_color(t.dim).truncate().child("Press ⌘⌥/ on an agent to ask it something on the side"));
    return bar.children(tabs.map(({ slot, label }) => h_flex().id(`tab-${slot}`).h(26).pl(10).pr(4).gap(6).items_center().rounded(6)
      .cursor_pointer().map((el) => slot === stack?.active ? el.bg(t.selected).text_color(t.foreground) : el.text_color(t.muted))
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => show(slot))
      .child(div().truncate().max_w(220).child(label))
      .child(div().id(`end-${slot}`).px(4).rounded(4).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.end(slot, open); }).child("✕"))))
      .child(div().flex_1().min_w(4)) // the banner, right of the tabs: it has the conversation, and can't reach the agent
      .child(div().flex_none().max_w(320).truncate().pr(6).text_size(11.5).text_color(t.dim)
        .child(bannerOf()));
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
      setShared("side.harnesses", withoutStale(this.picked, SUPPORTED)); // only what was flipped: a harness never switched stays on
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
    if (p.resident && retry && retry.at !== this.retryAt) { this.retryAt = retry.at; this.press(true); }
    if (p.resident) this.warm(); // here, not in init: the layout isn't read yet at init; warm() is idempotent
    return div();
  }
}
