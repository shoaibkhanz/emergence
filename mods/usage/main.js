// Usage: how you work across coding-agent harnesses (omp, Claude Code, Codex, OpenCode, pi), read from their
// own session logs on this machine. scan.py boils the logs down (cached); everything here is drawn natively.
// props().panel: the emergence layout's side panel (block "usage"); otherwise a popup (mod.open:usage).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, appHome, theme, settings, props, run, layout, shared, setShared, closeOverlay, nextCommand } from "herdr";
import { holder } from "./keyboard.js";
import { alpha } from "./charts.js";
import { skillsOf, summarize, outputOf, heat, startOfDay, addDays, DAY, LENGTHS, span, keepOf, tabAfter } from "./lib.js";
import { HARNESS, ORDER, WD, date, ago, iso, parse, hh } from "./format.js";
import { widgets } from "./widgets.js";
import { overview } from "./overview.js";
import { harnesses } from "./harnesses.js";
import { rhythm } from "./rhythm.js";
import { outputTab } from "./output.js";
import { compare } from "./compare.js";
import { skills } from "./skills.js";

const RANGES = [[7, "7d"], [30, "30d"], [90, "90d"], [365, "1y"], ["custom", "Custom"]];
// In the order worth looking at: the picture, which harness serves you best, what got delivered, then the detail.
const TABS = [["overview", "Overview"], ["compare", "Compare"], ["output", "Output"], ["harnesses", "Harnesses"], ["skills", "Skills"], ["rhythm", "Rhythm"]];

let data = null; // shared by every copy, so reopening is instant (↻ rescans)
let output = null; // git and gh facts for the Output tab, read after the sessions (they name the repos)
let scanned = 0, outputAt = 0; // when the last scan (started or) finished, and the last Output read: copies share them
let inflight = null; // the scan running now, shared: a copy opened meanwhile waits for it rather than starting its own
const SLOW_MS = 5000; // a scan running past this says why (a first scan reads every session on the machine)

// One scan for every copy: the sessions (scan.py), then git and gh for Output (output.py, at most every 15 min on the
// minute timer since gh shares your GitHub budget with your agents). `sessions` resolves as soon as they're read, so
// the panel draws them while Output is still reading.
function startScan(quick) {
  scanned = Date.now();
  const sessions = (async () => {
    const r = await exec("python3", [`${appHome()}/mods/usage/scan.py`], { timeout: 600000 });
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `scan.py exited ${r.code}`);
    data = JSON.parse(r.stdout);
  })();
  const done = sessions.then(async () => {
    if (quick && Date.now() - outputAt <= 15 * 60000) return;
    // Your commits, PRs and worktrees in the repos the sessions name, for the last year.
    const repos = [...new Set(data.sessions.map((s) => s.repo).filter(Boolean))];
    const o = await exec("python3", [`${appHome()}/mods/usage/output.py`, String(addDays(Date.now(), -365)), ...repos], { timeout: 180000 });
    if (o.code === 0) { output = JSON.parse(o.stdout); outputAt = Date.now(); }
  }).finally(() => { scanned = Date.now(); inflight = null; });
  return { sessions, done };
}
const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));

export default class Usage extends View {
  init(_props, cx) {
    this.panel = props()?.panel === true;
    this.handle = cx.focus_handle(); // a press anywhere takes the keyboard: ← / → walk the view tabs, as every panel's arrows do
    if (this.panel) { // the keyboard: opened, windows closing, dialogs, pane.go's focus (shared/keyboard.js)
      this.kb = holder({ id: "usage", panel: true, focus: () => this.handle.focus(), held: () => this.handle.is_focused(), shown: () => this.shown() });
      cx.spawn(async () => { for (;;) this.kb.command(await nextCommand()); });
      cx.timer.every(250, (cx) => { if (this.handle.is_focused() !== this.held) cx.notify(); }); // no blur event: a frame per change
    }
    // Every minute while it shows: a rescan reads only the logs that changed (about 1.5 s); Output's git and gh every 15.
    cx.timer.every(60000, (cx) => { if (this.shown() && Date.now() - scanned > 50000) this.scan(cx, true); });
    cx.timer.every(1000, (cx) => { if (!data && this.busy) cx.notify(); }); // the first read's elapsed seconds
    const r = localStorage.getItem("range");
    this.range = r === "custom" ? "custom" : Number(r ?? 30);
    this.tab = localStorage.getItem("tab") ?? "overview";
    this.off = new Set(JSON.parse(localStorage.getItem("off") ?? "[]")); // harnesses switched off
    this.metric = "sessions";
    this.same = false;
    this.kind = null;
    this.sel = null; // { kind: "days" | "slots", keys, from }: the part of the period picked on a chart (see press)
    this.selV = 0;
    this.width = 760;
    // Custom period: two dates, both included (typed, or clicked on the calendar).
    const saved = JSON.parse(localStorage.getItem("custom") ?? "null");
    this.custom = saved ?? { from: addDays(Date.now(), -13), to: startOfDay(Date.now()) };
    this.fromInput = InputState.new({ value: iso(this.custom.from), placeholder: "YYYY-MM-DD" });
    this.toInput = InputState.new({ value: iso(this.custom.to), placeholder: "YYYY-MM-DD" });
    this.typing = 0; // date fields with the caret: ← / → are theirs then (lib tabAfter)
    for (const input of [this.fromInput, this.toInput]) { input.on("focus", () => this.typing++); input.on("blur", () => (this.typing = Math.max(0, this.typing - 1))); }
    for (const [input, end] of [[this.fromInput, "from"], [this.toInput, "to"]]) input.on("change", (_e, cx) => {
      const t = parse(input.value());
      // Kept as typed (ends put in order where they're read), so editing one box never moves the other end.
      if (t != null) { this.custom = { ...this.custom, [end]: t }; this.picking = false; this.setSel(null); localStorage.setItem("custom", JSON.stringify(this.custom)); cx.notify(); }
    });
    if (!data) this.scan(cx);
  }

  // A calendar click sets the ends too (see heatmap), in order.
  setCustom({ from, to }) {
    this.custom = from <= to ? { from, to } : { from: to, to: from };
    localStorage.setItem("custom", JSON.stringify(this.custom));
  }

  // Picking part of the period: every number outside the chart picked on follows it; that chart stays whole and
  // lights what's picked. A press picks (pressing exactly the selection again clears it), dragging or
  // shift-click spans from the last press, cmd-click adds (or takes away what's already in).
  setSel(sel) { this.sel = sel; this.selV++; this.drag = null; }
  press(kind, at, e, cx) {
    cx.stop_propagation(); // a popup window drags by any press nobody stops
    const s = this.sel?.kind === kind ? this.sel : null, keys = span(kind, at, at), all = s && keys.every((k) => s.keys.has(k));
    const { shift, platform } = e.modifiers;
    if (all && platform) { const k = new Set(s.keys); keys.forEach((x) => k.delete(x)); return this.setSel(k.size ? { ...s, keys: k } : null); }
    if (all && !shift && s.keys.size === keys.length) return this.setSel(null);
    this.drag = { kind, from: shift && s ? s.from : at, base: platform && s ? s.keys : new Set() };
    this.dragTo(kind, at);
  }
  dragTo(kind, at) {
    const d = this.drag;
    if (d?.kind !== kind) return;
    this.sel = { kind, from: d.from, keys: new Set([...d.base, ...span(kind, d.from, at)]) };
    this.selV++;
  }
  // Whether a bar covering the days `at` is lit: always, unless days are picked and none of its are.
  lit(at) {
    return this.sel?.kind !== "days" || span("days", at, at).some((k) => this.sel.keys.has(k));
  }
  // A pickable element: press picks `at`, hovering while held drags to it; onHover(on) keeps its readout.
  pick(el, kind, at, onHover = () => {}) {
    return el.cursor_pointer().on_hover((on, cx) => { onHover(on); if (on) this.dragTo(kind, at); cx.notify(); })
      .on_mouse_down("left", (e, cx) => { this.press(kind, at, e, cx); cx.notify(); });
  }
  selLabel() {
    const { kind, keys } = this.sel, k = [...keys].sort((a, b) => a - b), run = (xs) => xs.every((x, i) => !i || x === xs[i - 1] + 1);
    if (kind === "days") {
      if (k.length === 1) return `${WD[(new Date(k[0]).getDay() + 6) % 7]} ${date(k[0])}`;
      return Math.round((k.at(-1) - k[0]) / DAY) === k.length - 1 ? `${date(k[0])} – ${date(k.at(-1))}` : `${k.length} days`;
    }
    const ds = [...new Set(k.map((x) => Math.floor(x / 24)))], hs = [...new Set(k.map((x) => x % 24))].sort((a, b) => a - b);
    if (ds.length * hs.length !== k.length) return `${k.length} hours of the week`;
    const day = ds.length === 7 ? "Every day" : ds.length === 1 ? WD[ds[0]] : run(ds) ? `${WD[ds[0]]}–${WD[ds.at(-1)]}` : ds.map((d) => WD[d]).join(", ");
    return `${day} ${run(hs) ? `${hh(hs[0])}–${hh(hs.at(-1) + 1)}` : `${hs.length} hours`}`;
  }

  // [from, to) in ms, with a label: the last N days up to now, or the custom dates including both.
  period(now) {
    if (this.range === "custom") {
      const lo = Math.min(this.custom.from, this.custom.to), hi = Math.max(this.custom.from, this.custom.to);
      return { from: lo, to: addDays(hi, 1), label: `${date(lo)} – ${date(hi)}`, days: Math.round((hi - lo) / DAY) + 1 };
    }
    return { from: addDays(now, 1 - this.range), to: now, label: this.range === 365 ? "the last year" : `the last ${this.range} days`, days: this.range };
  }

  // ↻ reads everything; the minute timer (quick) reruns git and gh for Output only every 15 min, since gh's calls
  // share your GitHub budget with your agents'.
  scan(cx, quick) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.scanFrom = Date.now();
    const job = inflight ?? (inflight = startScan(quick)); // another copy's scan running: wait for that one
    cx.spawn(async (cx) => {
      try {
        await job.sessions;
        cx.notify(); // the sessions show now; Output fills in when git and gh are done
        await job.done;
      } catch (e) { this.error = String(e?.message ?? e ?? "The scan stopped before it finished. Rescan (↻) to try again."); }
      this.busy = false;
      cx.notify();
    });
  }

  // The panel copy shows when the side panel is open on Usage; the popup copy whenever it exists.
  shown() {
    if (!this.panel) return true;
    const root = layout(), p = find(root, "panel");
    return Boolean(p) && !p.hidden && find(root, "panel-body")?.active === "usage";
  }

  header(t, present, counts, p) {
    const button = (id, tip, glyph, onClick) => h_flex().id(id).size(24).flex_none().items_center().justify_center().rounded(6)
      .text_color(t.muted).tooltip(tip).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(glyph);
    // Pointer handlers on Input are dropped (gpui-kit: only div/h_flex/...): the wrapper stops the press, so the
    // panel's own press-to-focus doesn't take the box's focus.
    const field = (state) => h_flex().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).w(104).h(24).px(8).items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
        .text_size(12).text_color(t.foreground));
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().h(42).px(14).gap(8).items_center()
        .child(div().flex_none().text_size(13).font_semibold().child("Usage"))
        .child(this.segmented(t, "range", RANGES, this.range, (v) => { this.range = v; this.picking = false; this.setSel(null); localStorage.setItem("range", String(v)); }))
        .child(div().flex_1())
        .when(Boolean(data), (el) => el.child(div().flex_none().max_w(260).truncate().text_size(11).text_color(this.error ? t.blocked : t.dim)
          .child(this.busy ? "scanning…" : this.error ? `rescan failed: ${this.error}` : `scanned ${ago(data.scanned_at)}`)))
        .child(button("usage-refresh", "Rescan the session logs", svg("mods/agent-graph/refresh.svg").size(13), (_e, cx) => { this.scan(cx); cx.notify(); }))
        .when(this.panel, (el) => el.child(button("usage-expand", "Open large", svg("mods/agent-graph/expand.svg").size(13), () => run("mod.open", { name: "usage" }))))
        .when(!this.panel && Boolean(props()?.overlay), (el) => el.child(div().id("usage-esc").flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim)
          .cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Esc"))))
      .when(this.range === "custom", (el) => el.child(h_flex().px(14).pb(10).gap(8).items_center().text_size(12).text_color(t.muted)
        .child("From").child(field(this.fromInput)).child("to").child(field(this.toInput))
        .child(div().text_size(11).text_color(t.dim).child(`${p.days} day${p.days === 1 ? "" : "s"}, both dates included · or click two days on the calendar`))))
      .when(present.length > 0, (el) => el.child(h_flex().px(14).pb(10).gap(6).items_center().children(present.map((h) => {
        const on = !this.off.has(h);
        return h_flex().id(`harness-${h}`).h(24).px(8).gap(6).flex_none().items_center().rounded(6).cursor_pointer()
          .border(1).border_color(on ? alpha(HARNESS[h].color, 0.5) : t.border).when(on, (el) => el.bg(alpha(HARNESS[h].color, 0.1)))
          .text_size(12).text_color(on ? t.foreground : t.dim).tooltip(on ? `Hide ${HARNESS[h].name}` : `Show ${HARNESS[h].name}`)
          .on_click((_e, cx) => { on ? this.off.add(h) : this.off.delete(h); localStorage.setItem("off", JSON.stringify([...this.off])); cx.notify(); })
          .child(div().when(!on, (el) => el.opacity(0.4)).child(this.icon(t, h, 14))).child(HARNESS[h].name)
          .child(div().text_size(11).text_color(t.dim).child(String(counts[h] ?? 0)));
      }))))
      // The views, one at a time, so none needs scrolling; then what's picked, if anything (click to clear).
      .child(h_flex().h(36).px(14).gap(18).items_end().children(TABS.map(([id, label]) => {
        const on = this.tab === id;
        return div().id(`tab-${id}`).h(36).flex().flex_none().items_center().text_size(13).cursor_pointer()
          .text_color(on ? t.foreground : t.muted).when(on, (el) => el.font_medium().border_b(2).border_color(t.accent))
          .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.tab = id; localStorage.setItem("tab", id); cx.notify(); }).child(label);
      })).when(Boolean(this.sel), (el) => el.child(div().flex_1()).child(h_flex().id("usage-sel").h(24).mb(6).px(8).gap(6).min_w(0).items_center().rounded(6)
        .border(1).border_color(alpha(t.accent, 0.5)).bg(alpha(t.accent, 0.1)).text_size(12).cursor_pointer().tooltip("Show the whole period")
        .hover((s) => s.bg(alpha(t.accent, 0.18))).on_click((_e, cx) => { this.setSel(null); cx.notify(); })
        .child(div().min_w(0).truncate().child(this.selLabel())).child(div().flex_none().text_color(t.muted).child("✕")))));
  }

  // The large popup (mod.open) closing gives the keyboard back to the side panel showing (emergence.back).
  async close() { if (!this.panel && props()?.overlay) setShared("emergence.back", Date.now()); }

  render(cx) {
    const t = theme(), vis = this.shown();
    if (vis && !this.wasShown) this.scan(cx, true); // shown again: don't wait up to a minute for the timer (busy guards a running scan)
    if (this.panel) { this.kb.tick(cx); this.held = this.handle.is_focused(); }
    this.wasShown = vis;
    const root = (this.panel
      ? v_flex().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      : v_flex().w_full().h((window.viewport_size().height * 0.88) / settings().zoom).bg(t.background))
      .id("usage-root").text_size(13).text_color(t.foreground).track_focus(this.handle)
      .on_size_change((s, cx) => { const w = s.width / settings().zoom; if (Math.abs(w - this.width) > 1) { this.width = w; cx.notify(); } })
      .on_key_down((e, cx) => {
        if (e.keystroke === "escape" && this.panel) return run("tabs-plus.back"); // back to the terminal
        if (e.keystroke !== "left" && e.keystroke !== "right") return;
        const next = tabAfter(TABS, this.tab, e.keystroke, this.typing > 0);
        if (!next) return; // a date field's caret
        this.tab = next;
        localStorage.setItem("tab", this.tab);
        cx.stop_propagation();
        cx.notify();
      })
      // A drag ends where the button comes up, or when the pointer leaves the panel.
      .on_mouse_down("left", () => this.handle.focus()).on_mouse_up("left", () => { this.drag = null; }).on_hover((on) => { if (!on) this.drag = null; });
    const sessions = data?.sessions ?? [];
    const present = ORDER.filter((h) => sessions.some((s) => s.h === h));
    const now = Date.now(), p = this.period(now);
    this.last = startOfDay(p.to - 1); // a weekly bar picks no day past the period
    // What's picked narrows everything: days replace the period, hours of the week filter inside it.
    const sel = this.sel, keep = sel ? keepOf(sel) : () => true;
    const win = sel?.kind === "days" ? { from: Math.min(...sel.keys), to: addDays(Math.max(...sel.keys), 1), days: sel.keys.size } : { from: p.from, to: p.to, days: null };
    const counts = {};
    for (const s of sessions) if (!s.sub && s.start >= win.from && s.start < win.to && keep(s.start)) counts[s.h] = (counts[s.h] ?? 0) + 1;
    root.child(this.header(t, present, counts, p));
    if (!data) {
      // How long it's been, and, once it runs long, why: a first scan reads every session on the machine.
      const ms = Date.now() - (this.scanFrom ?? Date.now());
      return root.child(v_flex().flex_1().items_center().justify_center().gap(8).p(24).text_center()
        .child(div().text_size(13).text_color(t.muted).child(this.busy ? `Reading your harnesses' session logs… ${Math.floor(ms / 1000)}s` : "Couldn't read the session logs."))
        .child(div().max_w(460).text_size(12).text_color(t.dim).child(!this.busy ? (this.error ?? "Rescan (↻) to try again.")
          : ms < SLOW_MS ? "omp, Claude Code, Codex, OpenCode and pi, on this machine."
          : "The first scan reads every session these harnesses have kept, so a long history can take a minute. After that, only what changed is read.")));
    }
    const on = new Set(present.filter((h) => !this.off.has(h)));
    // Weekday labels 31 + 14 per week must fit inside the body and card padding.
    const weeks = Math.max(8, Math.min(53, Math.floor((this.width - 32 - 28 - 31 - 12) / 14)));
    const key = `${data.scanned_at}|${p.from}|${p.to === now ? startOfDay(now) : p.to}|${[...on]}|${this.same}|${this.kind}|${weeks}|${this.metric}|${this.selV}|${this.skillBy}`;
    // The sums run after this frame: Herdr interrupts a render after ~100 ms, and a heavy year of sessions takes
    // longer than that (async work has no limit). Until they land, the last ones show. r0 and o0 are the whole
    // period, for the chart something was picked on; r and o are what's picked (the same, with nothing picked).
    if (this.memoKey !== key || this.memoOut !== output) {
      this.memoKey = key;
      const out = (this.memoOut = output);
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        if (this.memoKey !== key || this.memoOut !== out) return; // superseded
        const base = { harnesses: on, sameRepos: this.same, kind: this.kind };
        const r0 = summarize(sessions, { ...base, from: p.from, to: p.to }), r = sel ? summarize(sessions, { ...base, ...win, keep }) : r0;
        const o0 = out && outputOf(out, { from: p.from, to: p.to, step: r0.step }), o = sel ? out && outputOf(out, { from: win.from, to: win.to, step: r.step, keep }) : o0;
        const slots = sel?.kind === "slots";
        const sk = skillsOf(sessions, { from: win.from, to: win.to, harnesses: on, by: this.skillBy ?? "skill" });
        this.memo = { r0, r, o0, o, sk, cells: heat(sessions.filter((s) => on.has(s.h) && (!slots || keep(s.start))), { weeks, metric: this.metric }) };
        cx.notify();
      });
    }
    if (!this.memo) return root.child(v_flex().flex_1().items_center().justify_center().text_size(12).text_color(t.dim).child("Adding up…"));
    const { r0, r, o0, o, sk, cells } = this.memo, shown = present.filter((h) => on.has(h));
    const empty = div().p(12).text_center().text_size(13).text_color(t.muted).child(`No sessions in ${p.label} for the harnesses shown.`);
    const view = this.tab === "harnesses" ? (r0.tiles.sessions ? [this.over(t, r0, r, shown), this.models(t, r), this.effort(t, r, shown)] : [empty])
      : this.tab === "compare" ? [this.compare(t, r), ...(r.strengths.length ? [this.strengthsCard(t, r)] : [])]
      : this.tab === "output" ? this.outputView(t, r0, r, p, o0, o)
      : this.tab === "skills" ? this.skillsView(t, sk, p)
      : this.tab === "rhythm" ? (r0.tiles.sessions ? (() => {
        // A two-column dashboard: the tall hour grid (stretched to the column's height, the day split filling its
        // foot) beside the agents-at-once strip and the two bar cards stacked.
        const side = this.width >= 560, w = side ? this.width - 32 - 190 - 12 - 28 : this.width - 32 - 28;
        const lengths = this.bars(t, "How long runs last", "top-level sessions", LENGTHS.map(([, label], i) => [label, r.rhythm.lengths[i]]), w);
        const days = this.bars(t, "Days of the week", "sessions started", WD.map((d, i) => [d, r.rhythm.weekdays[i]]), w);
        return [this.rhythmTiles(t, r), side
          ? h_flex().gap(12).items_stretch().child(v_flex().w(190).flex_none().child(this.punch(t, r0, r).flex_1()))
            .child(v_flex().flex_1().min_w(0).gap(12).child(this.parallel(t, r0, r)).child(lengths).child(days))
          : v_flex().gap(12).child(this.punch(t, r0, r)).child(this.parallel(t, r0, r)).child(lengths).child(days)];
      })() : [empty])
      : [this.tiles(t, r), ...(r0.tiles.sessions ? [this.dayCard(t, r0, r, shown)] : []), this.heatmap(t, cells, weeks, p, r.tiles),
        ...(r.tiles.sessions ? [this.pair(this.spendCard(t, r), this.workCard(t, r)), this.tokensCard(t, r)]
        : this.sel ? [div().p(12).text_center().text_size(13).text_color(t.muted).child(`No sessions in ${this.selLabel()}. Clear it (✕, top right) to see ${p.label}.`)] : [])];
    return root.child(v_flex().id("usage-body").flex_1().min_h(0).p(16).gap(12).overflow_y_scrollbar().children(view));
  }
}

// The views' methods live beside this file, one file per tab (plus the shared widgets); each keeps using `this`.
Object.assign(Usage.prototype, widgets, overview, harnesses, rhythm, outputTab, compare, skills);
