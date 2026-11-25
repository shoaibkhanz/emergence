// A sub-agent's details: the dialog a sub-agent card opens (agent-graph's own mod, props { detail, owner, ownerName,
// name, sub, panel }), so you can see what it did without going to its agent's terminal. Three tabs:
//   Overview: four stat tiles (calls, time, tokens, cost), the mix of work it did, its task, its result;
//   Steps: every tool call on a timeline (runs of one kind folded, failures never), one opened with Space for its
//          input and the start of its output (read then, never kept);
//   Files: what it edited (uncommitted marked) and what it read.
// ←/→ switch tabs, ↑/↓ move, Space opens, ↵ goes to its agent (the one filled button), Esc closes. subagents.py reads
// the transcript when this opens and every 5 s while the sub-agent runs; nothing is cached.

import { div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, TextView } from "gpui-base";
import { run, exec, props, closeOverlay, theme, setShared, appHome, home } from "herdr";
import { subState, groupSteps, toolMix, stepKind, stepTarget, groupTarget, offset, took, tokens, costLabel, own, modelName, DIALOG, foldMarkdown } from "./lib.js";

const TABS = ["overview", "steps", "files"];
const FOLD = { task: 1200, result: 1600 }; // characters shown (whole lines, fences closed: lib foldMarkdown) until Space shows the rest
const LIVE_MS = 5000;
const WORD = { read: "Read", edit: "Edit", run: "Run", search: "Search", web: "Web", agent: "Sub-agent", other: "Other" };
const PY = () => `${appHome()}/mods/agent-graph/subagents.py`;
const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");
const clock = (at) => { const x = new Date(at); return `${x.getHours()}:${String(x.getMinutes()).padStart(2, "0")}`; };
const dur = (ms) => (ms == null ? "" : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : took(ms));

async function ask(flag, req) {
  const r = await exec("python3", ["-B", PY(), flag, JSON.stringify(req)], { timeout: 20000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  try { return JSON.parse(r.stdout); } catch { return { error: { message: (r.stderr || "subagents.py gave no answer").trim().split("\n").pop() } }; }
}

export class Detail {
  constructor(cx) {
    setShared("emergence.over", { at: Date.now(), open: true }); // the keyboard goes back where it was when this closes
    const p = props() ?? {};
    this.d = p.sub ? { ...p.sub, title: p.name, steps: [], read: [] } : null; // the card's facts while the transcript loads
    this.err = null;
    this.loading = true;
    this.tab = TABS.includes(p.tab) ? p.tab : "overview"; // the tab it opens on
    this.sel = { overview: "task", steps: null, files: null }; // per tab, by id (a refresh keeps it)
    this.open = new Set(); // ids shown whole: task, result, a step group, a step
    this.stepInfo = {}; // call -> { input, output, ok } | "loading" | { error }
    this.followed = true; // Steps follows the newest call while it runs, until you move
    this.scroll = { overview: ScrollHandle.new(), steps: ScrollHandle.new(), files: ScrollHandle.new() };
    this.kids = {}; // tab -> the id of each child of its scroll list, in order (null: not a row), for scroll_to_item
    this.h = cx.focus_handle();
    this.h.focus();
    cx.timer.after(300, () => this.h.focus());
    cx.spawn(async (cx) => {
      await cx.sleep(16); // host calls made before a copy's first frame never resolve
      let misses = 0; // refreshes that failed in a row (its agent gone): three end the live loop
      for (;;) {
        const out = await ask("--detail", p.detail);
        if (this.closed) return;
        if (out?.detail) { this.d = out.detail; this.err = null; this.got = true; misses = 0; this.follow = true; }
        else if (!this.got) this.err = out?.error?.message ?? "Couldn't read it."; // a later miss keeps what it showed
        else misses++;
        this.loading = false;
        cx.notify();
        if (this.err || !this.d?.running || misses >= 3) return;
        await cx.sleep(LIVE_MS);
        if (this.closed) return;
      }
    });
  }

  // went: Go to agent took the keyboard to a terminal, so the panel under this doesn't take it back (comeBack).
  async dismissed() {
    this.closed = true;
    setShared("emergence.over", { at: Date.now(), open: false, went: !!this.went });
  }

  close() { closeOverlay(props().overlay); }

  // From the side panel, the panel comes along to the agent's space (tabs-plus: shared "panel.carry"), as focusAgent.
  goToAgent() {
    if (String(props().owner ?? "").startsWith("ended:")) return; // its agent has ended: no terminal to go to
    if (props().panel) setShared("panel.carry", { id: "graph", at: Date.now() });
    this.went = true;
    run("agent.focus", { terminal: props().owner });
    this.close();
  }

  // ---- What ↑/↓ walk in each tab, by id ----

  rows() { return groupSteps(this.d?.steps ?? []); }

  items(tab = this.tab) {
    const d = this.d ?? {};
    if (tab === "overview") return ["task", "result"];
    if (tab === "files") return [...(d.edited ?? []).map((e) => `e:${e.path}`), ...(d.read ?? []).map((r) => `r:${r}`)];
    return this.rows().flatMap((r) => (r.group && this.open.has(r.id) ? [r.id, ...r.steps.map((s) => s.call)] : [r.group ? r.id : r.call]));
  }

  selected() {
    const list = this.items();
    if (this.tab === "steps" && this.followed && this.d?.running) return list[list.length - 1] ?? null;
    const sel = this.sel[this.tab];
    if (list.includes(sel)) return sel;
    const g = this.tab === "steps" && this.rows().find((r) => r.group && r.steps.some((x) => x.call === sel)); // a run grew around it
    return g ? g.id : list[0] ?? null;
  }

  toggle(id, cx) {
    if (!id) return;
    const was = this.open.has(id);
    this.open = was ? new Set([...this.open].filter((x) => x !== id)) : new Set([...this.open, id]);
    const call = !was && this.tab === "steps" && !id.startsWith("g:") ? id : null;
    const info = call && this.stepInfo[call];
    if (call && (!info || info.error || (info !== "loading" && info.output == null))) this.loadStep(call, cx); // again while it ran
  }

  loadStep(call, cx) {
    this.stepInfo = { ...this.stepInfo, [call]: "loading" };
    cx.spawn(async (cx) => {
      const out = await ask("--step", { ...props().detail, call });
      if (this.closed) return;
      this.stepInfo = { ...this.stepInfo, [call]: out?.step ?? { error: out?.error?.message ?? "Couldn't read it." } };
      cx.notify();
    });
  }

  key(e, cx) {
    const list = this.items(), at = list.indexOf(this.selected());
    if (e.key === "escape") this.close();
    else if (e.key === "enter") this.goToAgent();
    else if (e.key === "left" || e.key === "right") this.tab = TABS[(TABS.indexOf(this.tab) + (e.key === "left" ? TABS.length - 1 : 1)) % TABS.length];
    else if ((e.key === "down" || e.key === "up") && list.length) {
      this.sel = { ...this.sel, [this.tab]: list[Math.max(0, Math.min(list.length - 1, at + (e.key === "down" ? 1 : -1)))] };
      if (this.tab === "steps") this.followed = false;
    } else if (e.key === "space" || e.key_char === " ") this.toggle(this.selected(), cx);
    else return;
    this.scrollTo(this.selected());
    cx.stop_propagation();
    cx.notify();
  }

  scrollTo(id) {
    const i = (this.kids[this.tab] ?? []).indexOf(id);
    if (i >= 0) this.scroll[this.tab].scroll_to_item(i);
  }

  // ---- Drawing ----

  kindColor(t, kind) {
    return { read: t.ansi4, edit: t.accent, run: t.working, search: t.ansi5, web: t.ansi6, agent: t.done }[kind] ?? t.dim;
  }

  card(t, id, child) {
    const on = id && this.selected() === id;
    return v_flex().id(`dt-${id ?? "card"}`).px(12).py(10).rounded(8).bg(t.surface).border_1().border_color(on ? t.input : t.border)
      .when(Boolean(id), (el) => el.cursor_pointer().on_click((_e, cx) => { this.sel = { ...this.sel, [this.tab]: id }; this.toggle(id, cx); cx.notify(); }))
      .child(child);
  }

  label(t, text, extra) {
    return h_flex().gap(8).items_center().child(div().text_size(11.5).font_medium().text_color(t.dim).child(text))
      .when(Boolean(extra), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(extra)));
  }

  // Markdown, Herdr's own (TextView: selectable), folded to its first whole lines within `fold` characters until opened
  // (lib foldMarkdown: a cut never leaves a code fence open).
  text(t, id, body, fold, empty) {
    if (!body) return div().text_color(t.dim).child(empty);
    const whole = this.open.has(id), all = foldMarkdown(body, Infinity), part = foldMarkdown(body, fold), shown = whole ? all : part;
    return v_flex().gap(2)
      .child(TextView.markdown(`md-${id}-${whole ? "all" : part.more}`, shown.text).selectable(true).scrollable(false)
        .w_full().text_size(13).text_color(t.foreground))
      .when(part.more > 0, (el) => el.child(div().pt(6).text_size(12).text_color(t.muted)
        .child(whole ? "Show less (space)" : `${part.more} more lines (space)`)));
  }

  tile(t, name, value, sub, tone) {
    return v_flex().flex_1().min_w(0).gap(2).px(12).py(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(name))
      .child(div().truncate().text_size(18).font_semibold().text_color(t.foreground).child(value))
      .child(div().truncate().text_size(11).text_color(tone ?? t.dim).child(sub || " "));
  }

  overview(t, d) {
    const steps = d.steps ?? [], failed = steps.filter((s) => s.ok === false).length, m = own(d), mix = toolMix(steps);
    const span = d.startedAt != null ? (d.running ? Date.now() : d.endedAt ?? Date.now()) - d.startedAt : null;
    const tiles = h_flex().gap(8)
      .child(this.tile(t, "Tool calls", String(steps.length || m.tools), failed ? `${failed} failed` : steps.length ? "none failed" : "", failed ? t.blocked : null))
      .child(this.tile(t, d.running ? "Running for" : "Ran for", span != null ? took(span) : "–", d.startedAt ? `started ${clock(d.startedAt)}` : ""))
      .child(this.tile(t, "Tokens", m.tokens ? tokens(m.tokens) : "–", modelName(d.model) ?? ""))
      .child(this.tile(t, "Cost", costLabel(m) || "–", m.estimate ? "at API prices" : d.costKind === "api" ? "API key" : d.costKind === "recorded" ? "omp's own figure" : ""));
    const bar = !mix.length ? null : v_flex().gap(8)
      .child(h_flex().h(6).w_full().rounded(3).overflow_hidden().gap(2)
        .children(mix.map((x) => div().h_full().flex_grow(x.n).flex_basis(0).min_w(4).bg(this.kindColor(t, x.kind)))))
      .child(h_flex().gap(14).flex_wrap().children(mix.map((x) => h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(div().size(6).rounded(3).bg(this.kindColor(t, x.kind))).child(`${WORD[x.kind]} ${x.n}`))));
    return v_flex().gap(18)
      .child(tiles)
      .when(Boolean(bar), (el) => el.child(v_flex().gap(6).child(this.label(t, "What it did")).child(bar)))
      .child(v_flex().gap(6).child(this.label(t, "Task")).child(this.card(t, "task", this.loading ? div().text_color(t.dim).child("Reading its transcript…")
        : this.text(t, "task", d.task, FOLD.task, "No task recorded."))))
      .child(v_flex().gap(6).child(this.label(t, "Result")).child(this.card(t, "result", this.loading ? div().text_color(t.dim).child("…")
        : this.text(t, "result", d.result, FOLD.result, d.running ? "Still working." : "It ended without a report."))));
  }

  // One timeline row: offset, kind dot, what it did, on what, how long, failed.
  stepRow(t, s, depth, d) {
    const id = s.group ? s.id : s.call, on = this.selected() === id, open = this.open.has(id), kind = s.group ? s.kind : stepKind(s.tool);
    const bare = !s.group && s.tool?.toLowerCase() === "bash" && s.label === "Running a command" && s.target; // no description: the program says it
    const what = s.group ? `${WORD[kind]} · ${s.steps.length} calls` : bare ? s.target : s.label;
    const target = s.group ? groupTarget(s.steps) : bare ? "" : stepTarget(s);
    const row = h_flex().id(`st-${id}`).h(28).flex_none().px(8).gap(10).items_center().rounded(4).cursor_pointer()
      .when(on, (el) => el.bg(t.hover)).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { this.sel = { ...this.sel, steps: id }; this.followed = false; this.toggle(id, cx); cx.notify(); })
      .child(div().w(52).flex_none().text_size(11.5).text_color(t.dim).child(d.startedAt != null ? offset(s.at - d.startedAt) : ""))
      .child(div().pl(depth * 16).flex_none().child(div().size(7).rounded(4).bg(this.kindColor(t, kind))))
      .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(what))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(target ?? ""))
      .child(s.ok === false ? div().flex_none().px(6).py(1).rounded(4).bg(alpha(t.blocked, 0.15)).text_size(11).text_color(t.blocked).child("failed")
        : s.ok == null && d.running ? div().flex_none().text_size(11).text_color(t.working).child("running")
        : div().flex_none().text_size(11).text_color(t.dim).child(dur(s.ms)))
      .when(s.group, (el) => el.child(div().flex_none().w(10).text_size(11).text_color(t.dim).child(open ? "▾" : "▸")));
    const info = !s.group && open ? this.stepInfo[s.call] : null;
    return [row, ...(info ? [this.stepOpen(t, s, info)] : [])];
  }

  stepOpen(t, s, info) {
    // A fenced block in Herdr's markdown view: its code font, selectable (a longer fence than any in the text).
    const box = (title, body) => v_flex().gap(4).child(div().text_size(11).text_color(t.dim).child(title))
      .child(TextView.markdown(`so-${s.call}-${title}`, `${"`".repeat(6)}\n${body ?? ""}\n${"`".repeat(6)}`).selectable(true).scrollable(false)
        .w_full().text_size(12).text_color(t.foreground));
    return v_flex().id(`so-${s.call}`).flex_none().ml(62).mr(8).mb(6).gap(8)
      .child(info === "loading" ? div().text_size(12).text_color(t.dim).child("Reading…")
        : info.error ? div().text_size(12).text_color(t.muted).child(info.error)
        : v_flex().gap(8).when(Boolean(info.input), (el) => el.child(box(s.tool?.toLowerCase() === "bash" ? "Command" : "Input", info.input)))
          .child(info.output == null ? div().text_size(12).text_color(t.dim).child("No output yet.") : box(info.ok === false ? "Output · failed" : "Output", info.output)));
  }

  steps(t, d) {
    const rows = this.rows();
    if (!rows.length) return div().text_color(t.dim).child(this.loading ? "Reading its transcript…" : "No tool calls.");
    const kids = [], keys = [];
    const add = (s, depth) => this.stepRow(t, s, depth, d).forEach((el, i) => { kids.push(el); keys.push(i ? null : s.group ? s.id : s.call); });
    for (const r of rows) { add(r, 0); if (r.group && this.open.has(r.id)) r.steps.forEach((x) => add(x, 1)); }
    this.kids.steps = keys;
    if (this.follow && this.followed && d.running) { this.follow = false; this.scroll.steps.scroll_to_item(keys.length - 1); } // the newest call in view
    return v_flex().id("dt-steps").flex_1().min_h(0).p(4).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .overflow_y_scrollbar().track_scroll(this.scroll.steps).children(kids);
  }

  fileRow(t, id, p, dirty, dim) {
    const cut = p.lastIndexOf("/"), dir = stepTarget({ tool: "Read", target: p }); // its last two folders; the whole path on hover
    return h_flex().id(`df-${id}`).h(28).flex_none().px(8).gap(8).items_center().rounded(4).when(this.selected() === id, (el) => el.bg(t.hover)).tooltip(p)
      .child(div().size(6).flex_none().rounded(3).when(dirty, (el) => el.bg(t.accent)))
      .child(div().flex_none().max_w(320).truncate().text_color(dim ? t.muted : t.foreground).child(p.slice(cut + 1)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(dir))
      .when(dirty, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("uncommitted")));
  }

  files(t, d) {
    const edited = d.edited ?? [], read = d.read ?? [];
    if (!edited.length && !read.length) return div().text_color(t.dim).child(this.loading ? "Reading its transcript…" : "It touched no files.");
    // One scrolling card, its rows its children (scroll_to_item counts them), each list headed inside it.
    const head = (title, n, first) => h_flex().h(28).flex_none().px(8).items_center().when(!first, (el) => el.mt(8)).child(this.label(t, title, String(n)));
    const rows = [...(edited.length ? [[null, head("Edited", edited.length, true)]] : []),
      ...edited.map((e) => [`e:${e.path}`, this.fileRow(t, `e:${e.path}`, e.rel ?? e.path.replace(home(), "~"), e.dirty, false)]),
      ...(read.length ? [[null, head("Read", read.length, !edited.length)]] : []),
      ...read.map((r) => [`r:${r}`, this.fileRow(t, `r:${r}`, r, false, true)])];
    this.kids.files = rows.map(([k]) => k);
    return v_flex().id("dt-files").flex_1().min_h(0).p(4).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .overflow_y_scrollbar().track_scroll(this.scroll.files).children(rows.map(([, el]) => el));
  }

  tabs(t, d) {
    const n = { steps: d.steps?.length || null, files: (d.edited?.length ?? 0) + (d.read?.length ?? 0) || null };
    return h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.raised).border_1().border_color(t.input).self_start()
      .children(TABS.map((k) => h_flex().id(`dt-tab-${k}`).h(26).px(12).gap(6).items_center().rounded(6).text_size(12.5).cursor_pointer()
        .map((el) => (k === this.tab ? el.bg(t.background).text_color(t.foreground) : el.text_color(t.muted)))
        .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.tab = k; cx.notify(); })
        .child(k[0].toUpperCase() + k.slice(1)).when(n[k] != null, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(n[k]))))));
  }

  render() {
    const t = theme(), d = this.d ?? {}, now = Date.now(), p = props() ?? {};
    const facts = [d.type, p.ownerName && `from ${p.ownerName}`, d.worktree && `in ${d.worktree.split("/").pop()}`].filter(Boolean).join(" · ");
    const state = d.running && d.steps?.length ? `Working · ${d.steps[d.steps.length - 1].label}` : subState({ running: d.running, updatedAt: d.endedAt ?? now }, now);
    const body = this.err
      ? v_flex().flex_1().min_h(0).gap(6).child(div().text_color(t.muted).child(this.err))
        .child(div().text_size(12).text_color(t.dim).child("History is kept a week at most (Emergence settings: Sub-agent history); past that, a sub-agent drops out."))
      : this.tab === "overview" ? v_flex().id("dt-overview").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll.overview).child(this.overview(t, d))
      : this.tab === "steps" ? this.steps(t, d) : this.files(t, d);
    const button = String(p.owner ?? "").startsWith("ended:") ? div().text_size(12).text_color(t.dim).child("Its agent has ended")
      : h_flex().id("dt-go").h(DIALOG.button).px(14).gap(6).items_center().rounded(8).cursor_pointer().border_1().text_size(12).font_medium()
        .bg(t.solid).border_color(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88))
        .on_click(() => this.goToAgent()).child("Go to agent").child(div().text_size(11).opacity(0.7).child("↵"));
    return v_flex().id("ag-detail").track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(DIALOG.pad).gap(DIALOG.gap).rounded(DIALOG.radius).bg(t.popover).text_size(13)
      .child(v_flex().flex_none().gap(4)
        .child(h_flex().h(DIALOG.title).items_center().gap(12)
          .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(d.title ?? "Sub-agent"))
          .child(h_flex().flex_none().max_w(260).gap(6).items_center().text_size(12).text_color(d.running ? t.working : t.muted)
            .child(div().size(6).flex_none().rounded(3).bg(d.running ? t.working : t.dim)).child(div().truncate().child(state)))
          .child(div().id("dt-esc").flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
        .when(Boolean(facts), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(facts))))
      .child(this.tabs(t, d))
      .child(body)
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child("←/→ tabs · ↑/↓ move · space opens"))
        .child(button));
  }
}
