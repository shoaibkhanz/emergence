// Agent graph: every live terminal as repo -> worktree (branch + PR) -> agent -> sub-agent.
// Live data re-renders; git facts (30 s) and `gh pr list` (60 s) are cached per cwd / repo. In-process sub-agents
// (Claude Code's Task/Agent, omp's task) come from subagents.py: with each refresh, and every 5 s while one works.
// props().panel: lives in the emergence layout's right panel (block "graph") instead of a popup.

import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, focused, exec, run, theme, settings, props, closeOverlay, openOverlay, setShared, shared, home, layout, appHome, nextCommand } from "herdr";
import { buildTree, layout as graphLayout, parseRevParse, prsByBranch, mrsAsPRs, cleanTitle, RANK, mix, sidebarCursor, openOnActive, filterCounts, activeNudge, graphTerminals,
  subItems, dotsAlpha, grainOpacity, backdrop, subState, harnessOf, subRequests, overlaps, conflictsOf, metered, fold, foldables, metricLine, costLabel, summary, refold, worktreeOwners, worktreeNote, GONE, detailRequest, historySince, trackSessions, endedItems } from "./lib.js";
import { Detail } from "./detail.js";
import { holder } from "./keyboard.js";
import { list } from "./list.js";

const GIT_TTL = 30000, PR_TTL = 60000, SUB_FAST = 5000;
const MAX_FILES = 8; // a sub-agent's edited files listed in its hover
const ZMIN = 0.3, ZMAX = 2, ZFIT = 1, PAD = 48;
// A panel fits the graph to its width; below this zoom it runs off the bottom rather than shrink the text.
const PANEL_PAD = 24, PANEL_Z = 0.6;
const STATUS = ["blocked", "done", "working", "idle"];
const WORD = { blocked: "Blocked", done: "Done", working: "Working", idle: "Idle" };
const ICON = (f) => `mods/agent-graph/${f}.svg`;
const key = (m, p) => `${m ?? ""}|${p}`;
const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");
const clamp = (z) => Math.min(ZMAX, Math.max(ZMIN, z));
const ESTIMATE = "≈ at API prices (subscription)";
const noTerminal = (d) => !!d.history || !!d.ended || Array.isArray(d.agents); // a history card, an ended agent, a worktree: Enter / a click folds it

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const panelShows = (block) => { const p = find(layout(), "panel"); return !!p && !p.hidden && find(p, "panel-body")?.active === block; };

// A folder gone from disk (a worktree deleted outside the sidebar, its terminal still there): GONE, so it draws no card.
async function facts(on, cwd) {
  try {
    if ((await exec("test", ["-d", cwd], { on })).code === 1) return GONE;
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"], { cwd, on });
    const f = r.code === 0 ? parseRevParse(r.stdout) : null;
    if (f?.branch) {
      const ab = await exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on });
      if (ab.code === 0) [f.ahead, f.behind] = ab.stdout.trim().split(/\s+/).map(Number);
    }
    return f;
  } catch {
    return null;
  }
}

// The repo's PRs by branch: GitHub's through gh, GitLab's merge requests through glab (by the origin remote).
async function pulls(on, cwd) {
  try {
    const url = (await exec("git", ["remote", "get-url", "origin"], { cwd, on })).stdout ?? "";
    if (!/github/i.test(url)) { // GitLab, else (GitHub Enterprise, an ssh alias) gh below
      const r = await exec("glab", ["mr", "list", "--all", "-P", "100", "-F", "json"], { cwd, on }).catch(() => null); // no glab here: gh
      if (r?.code === 0) return prsByBranch(mrsAsPRs(JSON.parse(r.stdout)));
    }
    const r = await exec("gh", ["pr", "list", "--state", "all", "--limit", "100", "--json", "number,state,isDraft,headRefName,title,url,reviewDecision"], { cwd, on });
    return r.code === 0 ? prsByBranch(JSON.parse(r.stdout)) : null;
  } catch {
    return null;
  }
}

const GRAIN = 256; // grain.png's tile (logical px at zoom 1); how strong is Settings' Grain (grainOpacity)
// A working agent's dot breathes so it reads as running at a glance: Herdr's native loop (AGENTS.md: animate
// natively, never with a timer), which runs without this script and stops while the graph isn't drawn.
const BREATH = { from: 0.4, to: 1, period: 1600 };

export default class AgentGraph extends View {
  init(_props, cx) {
    if (props()?.detail) { this.detail = new Detail(cx); return; } // a sub-agent's details (openDetail): its own view
    setShared("agent-graph.historyOffered", true); // Emergence settings shows Sub-agent history once this reads it
    this.sessions = shared("agent-graph.ended") ?? {}; // agents' sessions, so an ended one keeps its sub-agents (lib trackSessions)
    this.panel = props()?.panel === true;
    this.git = new Map(); // machine|cwd -> { at, v: facts | null }
    this.prs = new Map(); // machine|common -> { at, v: Map | null }
    this.busy = false;
    this.loaded = false;
    this.activeOnly = null; // Active | All: decided each time the panel opens (lib openOnActive), then the person's
    this.pick = localStorage.getItem("view"); // "graph" | "list": the person's pick, kept; a graph until they pick List
    this.view = null; // { x, y, z } once the person pans or zooms; null = fitted
    this.offsets = new Map(JSON.parse(localStorage.getItem("offsets") || "[]")); // node id -> { x, y } the person dragged it by
    this.sel = null;
    this.folds = refold(JSON.parse(localStorage.getItem("folds") || "{}")); // card id -> folded (true) / open (false) the person chose
    this.owners = new Map(); // worktree card id -> the sub-agent working there (render, lib worktreeOwners)
    this.subs = {}; // subagents.py's last answer: address -> { edited, subagents }
    this.subsJSON = "{}";
    this.subsLoop = false;
    this.h = cx.focus_handle();
    if (this.panel) { // the keyboard: opened, windows closing, dialogs, pane.go's focus (shared/keyboard.js)
      this.kb = holder({ id: "graph", panel: true, focus: () => this.h.focus(), held: () => this.h.is_focused(), shown: () => this.shown() });
      cx.spawn(async () => { for (;;) this.kb.command(await nextCommand()); });
      cx.timer.every(250, (cx) => { if (this.h.is_focused() !== this.held) cx.notify(); }); // no blur event: a frame per change
    }
    if (!this.panel) {
      this.h.focus();
      cx.timer.after(300, () => this.h.focus());
    }
    // The first render refreshes (and again whenever a hidden panel comes back).
    cx.timer.every(GIT_TTL, (cx) => { if (this.shown()) this.refresh(cx); });
  }

  // A panel copy stays alive while hidden; it skips git / gh work until shown.
  shown() {
    return !this.panel || panelShows("graph");
  }

  // Every live terminal, flattened from agents / panes / spaces.
  items() {
    const ag = new Map(agents().map((a) => [a.address, a]));
    const pane = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p]));
    const tabs = new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, { label: `${s.name} / ${t.name}`, space: s.id }])));
    const sideSlots = (find(layout(), "side-slots")?.children ?? []).map((c) => c.id);
    return graphTerminals(terminals(), sideSlots).map((x) => {
      const a = ag.get(x.address), machine = x.address.includes("/") ? x.address.split("/")[0] : null;
      const lbl = x.labels?.["herdr.tab"];
      // A sub-agent without a pane reports to its parent: its done is the parent's news.
      let s = a?.status ?? (x.status === "error" ? "blocked" : x.status === "done" ? "idle" : x.status);
      const cwd = pane.get(x.address)?.cwd ?? x.foreground?.cwd ?? x.cwd ?? null;
      const agent = !!(a || x.report || x.program?.agent);
      const program = a?.program ?? x.program;
      const tab = tabs.get(a?.tab ?? (lbl && machine ? `${machine}/${lbl}` : lbl));
      return {
        id: x.address, parent: x.parent ?? null, machine, cwd, agent, program,
        pid: x.foreground?.pid ?? x.pid ?? null, harness: harnessOf(a?.app, program?.key),
        status: s in RANK ? s : "idle",
        name: cleanTitle(a?.title || x.title || x.name) || (agent ? program?.name : cwd?.split("/").filter(Boolean).pop()) || x.address,
        kind: agent ? null : x.foreground?.name ?? program?.name ?? "terminal",
        tab: tab?.label ?? null, space: tab?.space ?? null,
      };
    });
  }

  refresh(cx, force = false) {
    // busy = start time; a refresh hung past a minute no longer blocks the next one.
    if (this.busy && Date.now() - this.busy < 60000) return;
    const me = this.busy = Date.now();
    const items = this.items();
    this.pollSubs(cx);
    cx.spawn(async (cx) => {
      try {
        await cx.sleep(16); // host calls made before a copy's first frame never resolve
        const now = Date.now(), stale = (c, ttl) => force || !c || now - c.at >= ttl;
        const cwds = new Map(items.filter((i) => i.cwd).map((i) => [key(i.machine, i.cwd), i]));
        for (const s of subItems(items, this.subs)) if (s.sub?.worktree) cwds.set(key(s.machine, s.sub.worktree), { machine: s.machine, cwd: s.sub.worktree });
        await Promise.all([...cwds].filter(([k]) => stale(this.git.get(k), GIT_TTL))
          .map(async ([k, i]) => this.git.set(k, { at: now, v: await facts(i.machine, i.cwd) })));
        this.loaded = true;
        cx.notify();
        const repos = new Map();
        for (const [k, i] of cwds) {
          const v = this.git.get(k)?.v;
          if (v?.common) repos.set(key(i.machine, v.common), { on: i.machine, top: v.top });
        }
        await Promise.all([...repos].filter(([k]) => stale(this.prs.get(k), PR_TTL))
          .map(async ([k, r]) => this.prs.set(k, { at: now, v: await pulls(r.on, r.top) })));
      } finally {
        if (this.busy === me) this.busy = 0;
        cx.notify();
      }
    });
  }

  // In-process sub-agents: read once per refresh, then every 5 s while something works and the graph shows; one loop
  // at a time, never spinning ↻ (busy). No timer of its own: it lives in the refresh's task.
  pollSubs(cx) {
    if (this.subsLoop) return;
    this.subsLoop = true;
    cx.spawn(async (cx) => {
      try {
        for (let i = 0; i < 100 && !this.loaded; i++) await cx.sleep(50); // git tops first: files show worktree-relative
        for (;;) {
          await this.readSubs(cx);
          if (!this.shown() || !this.lively()) break;
          await cx.sleep(SUB_FAST);
          if (!this.shown()) break;
        }
      } finally {
        this.subsLoop = false;
      }
    });
  }

  lively() {
    return this.items().some((i) => i.status === "working") || Object.values(this.subs).some((a) => a.subagents?.some((s) => s.running));
  }

  // One subagents.py run for this computer's claude and omp agents; redraws only when its answer changed. A failed run
  // keeps the last answer.
  async readSubs(cx) {
    const top = (i) => this.git.get(key(i.machine, i.cwd))?.v?.top ?? null, items = this.items();
    const req = subRequests(items, top, this.sessions);
    let agents = {};
    if (req.length) {
      try {
        const r = await exec("python3", ["-B", `${appHome()}/mods/agent-graph/subagents.py`, "--json", JSON.stringify(req)], { timeout: 20000 });
        const o = r.code === 0 ? JSON.parse(r.stdout) : null;
        if (!o?.agents) return;
        agents = o.agents;
      } catch {
        return;
      }
    }
    // Sessions seen running are remembered; one that stops is an ended agent, kept for the Sub-agent history window.
    const t = trackSessions(this.sessions, items, agents, top, Date.now(), historySince(shared("agent-graph.history"), Date.now()));
    this.sessions = t.sessions;
    if (t.save) setShared("agent-graph.ended", t.sessions);
    const json = JSON.stringify(agents);
    if (json === this.subsJSON) return;
    this.subsJSON = json;
    this.subs = agents;
    cx.notify();
  }

  dismiss() {
    if (!this.panel) closeOverlay(props().overlay);
  }

  // A sub-agent has no terminal of its own: its agent's.
  // From the panel, the panel comes along to the agent's space (tabs-plus: shared "panel.carry").
  focusAgent(n) {
    if (this.panel) setShared("panel.carry", { id: "graph", at: Date.now() });
    run("agent.focus", { terminal: n.owner ?? n.id });
    this.dismiss();
  }

  // A sub-agent: its details in a dialog over the graph (detail.js), not its agent's terminal; one it can't read yet
  // (omp, another machine) still goes to its agent. The large popup closes first: a dialog doesn't sit over a popup.
  open(n) {
    if (!n.sub) return this.focusAgent(n);
    const owners = [...this.items(), ...endedItems(this.sessions, this.subs, 0)];
    const req = detailRequest(n, owners, (i) => this.git.get(key(i.machine, i.cwd))?.v?.top ?? null);
    if (!req) return this.focusAgent(n);
    this.handoff = true; // the dialog takes the keyboard: the side panel mustn't (close's emergence.back)
    this.dismiss();
    openOverlay({ mod: "agent-graph", kind: "window", key: "agent-details", width: 680, height: 0.9, props: { detail: req, owner: n.owner, ownerName: owners.find((i) => i.id === n.owner)?.name ?? null, name: n.name, sub: n.sub, panel: this.panel } });
  }

  // Cross-mod deep link: pr-review picks this up (if < 30 s old) and selects the PR.
  // With a PRs panel in the layout (emergence) that panel takes it; otherwise the pr-review window.
  openPr(w) {
    setShared("pr-review.open", { repo: w.top, machine: w.machine, number: w.pr.number, at: Date.now() });
    if (!find(layout(), "prs")) run("mod.open", { name: "pr-review" }); // it re-opens itself centred, replacing any open one
    else if (!panelShows("prs")) run("tabs-plus.prs");
    this.dismiss();
  }

  // Every checkout of a repo in Herdr's own Open worktree dialog: filter, then Enter goes to it (a space).
  worktrees(r) {
    openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { folder: r.worktrees[0].top, machine: r.machine, action: "open" } });
    this.dismiss();
  }

  fitView(L) {
    const W = this.size.width, H = this.size.height, p = this.panel ? PANEL_PAD : PAD;
    const wz = (W - 2 * p) / Math.max(1, L.width), hz = (H - 2 * p) / Math.max(1, L.height);
    // A panel is tall and narrow: rather than shrink text to fit the height, run off the bottom (scroll pans).
    const z = clamp(Math.min(ZFIT, wz, this.panel ? Math.max(hz, PANEL_Z) : hz));
    return { z, x: (W - L.width * z) / 2 - L.x0 * z, y: Math.max(p, (H - L.height * z) / 2) - L.y0 * z };
  }

  // Cards the person dragged keep their offset (graph px) on top of the automatic layout; edges follow.
  moved(L) {
    const nodes = L.nodes.map((n) => { const o = this.offsets.get(n.id); return o ? { ...n, x: n.x + o.x, y: n.y + o.y } : n; });
    const by = new Map(nodes.map((n) => [n.id, n]));
    const edges = L.edges.map((e) => { const a = by.get(e.from), b = by.get(e.to); return { ...e, a: { x: a.x + a.w, y: a.y + a.h / 2 }, b: { x: b.x, y: b.y + b.h / 2 } }; });
    const x0 = Math.min(...nodes.map((n) => n.x)), y0 = Math.min(...nodes.map((n) => n.y));
    return { nodes, edges, x0, y0, width: Math.max(...nodes.map((n) => n.x + n.w)) - x0, height: Math.max(...nodes.map((n) => n.y + n.h)) - y0 };
  }

  // A drag ends on release or when the pointer leaves the canvas; arranged cards are remembered,
  // and a view that was fitted before the drag fits again (the drag only pinned it while moving).
  endDrag() {
    if (this.drag?.node && this.drag.moved) localStorage.setItem("offsets", JSON.stringify([...this.offsets]));
    if (this.drag?.fitted) this.view = null;
    this.drag = null;
  }

  // Folding a card (or all of them: ids) is remembered in this copy's localStorage.
  setFold(ids, folded) {
    this.folds = { ...this.folds, ...Object.fromEntries(ids.map((id) => [id, folded])) };
    localStorage.setItem("folds", JSON.stringify(this.folds));
  }

  // Enter or a click on a card with no terminal of its own (a worktree, a history card) folds or opens it.
  toggle(d) {
    if (d.foldable) this.setFold([d.id], !d.folded);
  }

  // A backdrop layer's path, kept by its key (the same key is the same geometry; only its offset moves with the pan),
  // so a still or panned canvas doesn't rebuild thousands of marks every frame.
  backdropPath(l) {
    const hit = l.key && this.paths?.get(l.key);
    if (hit) return hit;
    let p = l.stroke ? PathBuilder.stroke(l.stroke) : PathBuilder.fill();
    for (const q of l.polys ?? []) p = p.add_polygon(q, true);
    for (const [a, b, c, d] of l.segs ?? []) p = p.move_to(a, b).line_to(c, d);
    const built = p.build();
    if (l.key) { if (!this.paths || this.paths.size > 64) this.paths = new Map(); this.paths.set(l.key, built); }
    return built;
  }

  zoomAt(f, px, py) {
    const v = this.view ?? this.fitted, z = clamp(v.z * f), k = z / v.z;
    this.view = { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
  }

  // The large popup (mod.open) closing gives the keyboard back to the side panel showing (emergence.back).
  async close() {
    if (this.detail) return this.detail.dismissed();
    if (!this.panel && props()?.overlay && !this.handoff) setShared("emergence.back", Date.now());
  }

  render(cx) {
    if (this.detail) return this.detail.render(cx);
    const t = theme();
    this.Z = Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1;
    if (this.raw) this.size = { width: this.raw.width / this.Z, height: this.raw.height / this.Z };
    const shown = this.shown();
    const opening = shown && !this.wasShown; // a popup's first render, or a hidden panel shown again
    if (opening) this.refresh(cx);
    if (opening) this.folds = refold(this.folds); // earlier sub-agents start folded every time (lib refold)
    if (this.panel) { this.kb.tick(cx); this.held = this.h.is_focused(); }
    this.wasShown = shown;
    const items = this.items();
    if (opening || this.activeOnly === null) this.activeOnly = openOnActive(items); // however it was opened: the same rule
    if (opening || !openOnActive(items)) this.nudge = true; // the Active count may light again (lib activeNudge)
    if (shown && !this.busy && items.some((i) => i.cwd && !this.git.has(key(i.machine, i.cwd)))) this.refresh(cx);
    const cursor = sidebarCursor(shared("inbox.cursor"), shared("spaces.cursor")); // where the sidebar's keyboard is
    const foc = focused()?.terminal ?? null;
    this.now = Date.now();
    this.ov = overlaps(this.subs, this.now); // files two live writers both have uncommitted (lib)
    const since = historySince(shared("agent-graph.history"), Date.now());
    const withEnded = [...items, ...endedItems(this.sessions, this.subs, since)]; // ended agents with sub-agents in the window
    const subs = subItems(withEnded, this.subs, since);
    this.owners = worktreeOwners(withEnded, subs); // worktree card id -> the sub-agent working there (lib)
    const whole = buildTree(metered(withEnded, this.subs), (m, c) => this.git.get(key(m, c))?.v ?? null, (m, c) => this.prs.get(key(m, c))?.v ?? undefined,
      { activeOnly: this.activeOnly, cursor, focused: foc, subs }); // marks here: lib
    const tree = fold(whole, this.folds); // totals on every card; folded ones without their subtree (lib)
    const L = graphLayout(tree), M = this.moved(L); // M: with the person's dragged offsets
    const list = this.pick === "list"; // never switched for them: opening a group in the graph used to flip it to a list
    const walk = (a) => [{ data: a }, ...a.children.flatMap(walk)];
    const picks = list ? tree.flatMap((r) => r.worktrees.flatMap((w) => [{ data: w }, ...w.agents.flatMap(walk)]))
      : M.nodes.filter((n) => n.kind !== "repo").sort((a, b) => a.y - b.y || a.x - b.x);
    this.allFolds = foldables(whole);
    this.anyOpen = picks.some((n) => n.data.foldable && !n.data.folded);
    if (!picks.some((n) => n.data.id === this.sel)) this.sel = (picks.find((n) => n.data.here) ?? picks.find((n) => n.data.id === foc) ?? picks.find((n) => !noTerminal(n.data)) ?? picks[0])?.data.id ?? null;

    // A popup is as tall as its content (mod.json height is the cap): size to the window. A panel fills its block.
    const root = this.panel
      ? v_flex().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
        .on_mouse_down("left", () => this.h.focus())
      : v_flex().w_full().h(window.viewport_size().height * 0.88 / this.Z).bg(t.surface);
    return root.id("ag-root").text_size(13).text_color(t.foreground)
      .track_focus(this.h)
      .on_key_down((e, cx) => {
        const k = e.key, i = picks.findIndex((n) => n.data.id === this.sel), m = e.modifiers;
        if (m.platform || m.control || m.alt) return; // ⌘R, ⌘= … belong to the app
        if (k === "escape") return this.panel ? run("tabs-plus.back") : this.dismiss(); // the panel: back to the terminal
        if (k === "f") this.view = null;
        else if ((k === "-" || k === "=" || k === "+") && this.fitted && this.size) this.zoomAt(k === "-" ? 0.8 : 1.25, this.size.width / 2, this.size.height / 2);
        else if (k === "r") { this.offsets.clear(); localStorage.removeItem("offsets"); this.view = null; }
        else if (k === "a") { this.activeOnly = !this.activeOnly; this.view = null; this.nudge = false; }
        else if ((k === "left" || k === "right") && picks[i]?.data.foldable && picks[i].data.folded !== (k === "left")) this.setFold([this.sel], k === "left");
        else if ((k === "down" || k === "up") && picks.length) this.sel = picks[(i + (k === "down" ? 1 : picks.length - 1)) % picks.length].data.id;
        else if (k === "enter" && i >= 0 && noTerminal(picks[i].data)) this.toggle(picks[i].data);
        else if (k === "enter" && i >= 0) return this.open(picks[i].data);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(this.header(t, items, list))
      .child(list ? this.list(t, tree) : this.canvas(t, items, tree, M));
  }

  // The body reports its size (logical px times zoom); fitting and the header's width breakpoints read it.
  measure(el) {
    return el.on_size_change((s, cx) => {
      const r = this.raw;
      if (r && Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5) return;
      this.raw = { width: s.width, height: s.height };
      cx.notify();
    });
  }

  header(t, items, list) {
    const W = this.panel ? this.size?.width ?? Infinity : Infinity;
    const n = filterCounts(items);
    const button = (id, tip, onClick) => h_flex().id(id).h(24).px(8).gap(6).items_center().rounded(6).flex_none()
      .border(1).border_color(t.border).text_size(12).text_color(t.muted).cursor_pointer().tooltip(tip)
      .hover((s) => s.bg(t.hover).border_color(t.input).text_color(t.foreground))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); });
    const icon = (el) => el.w(24).px(0).justify_center().border_color(alpha(t.border, 0)) // icon buttons have no box, as in every panel
      .hover((s) => s.bg(t.hover).text_color(t.foreground));
    const hint = !this.panel ? "↑↓ select · ←→ fold · A active · all · ↵ open · F fit · R reset · Esc close"
      : W >= 1000 ? "↑↓ select · ←→ fold · A active · all · ↵ open · F fit · R reset" : null;
    // Active | All (A), each with what it shows: decided each time the panel opens (lib openOnActive), then yours.
    const pick = (active) => { if (this.activeOnly !== active) { this.activeOnly = active; this.view = null; this.nudge = false; } };
    // On All, a dot by the Active count says Active has something for you: amber when an agent needs you, else blue.
    const lit = activeNudge(items, { onAll: !this.activeOnly, armed: this.nudge }), tone = lit === "blocked" ? t.blocked : t.working;
    const box = (id, on, tip, onClick) => h_flex().id(id).h(20).px(8).gap(5).items_center().rounded(5).text_size(12).cursor_pointer()
      .tooltip(tip).text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.background))
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { onClick(); cx.notify(); });
    const group = (id) => h_flex().id(id).h(24).p(2).gap(2).flex_none().items_center().rounded(7).bg(t.raised);
    const seg = (id, active, label, count, tip) => box(id, this.activeOnly === active, tip, () => pick(active))
      .child(label).when(active && !!lit, (el) => el.child(div().size(6).rounded_full().bg(tone)))
      .child(div().text_size(11).text_color(active && lit ? tone : t.dim).child(String(count)));
    return h_flex().flex_none().items_center().border_b(1).border_color(t.border)
      .map((el) => this.panel ? el.h(42).px(14).gap(8) : el.h(40).px(16).gap(12))
      .child(div().flex_none().text_size(this.panel ? 13 : 15).font_semibold().child("Agents"))
      .child(div().flex_1())
      .when(!!hint, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(hint)))
      // The view's controls sit on the right, the filter first, by refresh and expand.
      .child(group("ag-filter")
        .child(seg("ag-active", true, "Active", n.active, lit === "blocked" ? "An agent needs you: Active shows only what's going on (A)"
          : lit ? "Agents are working: Active shows only what's going on (A)" : "Agents working, needing you or finished (A)"))
        .child(seg("ag-all", false, "All", n.all, "Every agent and terminal (A)")))
      // Graph | List: the person's pick, kept.
      .child(group("ag-view")
        .child(box("ag-graph", !list, "Show the graph", () => this.setPick("graph")).child("Graph"))
        .child(box("ag-list-pick", list, "Show a list", () => this.setPick("list")).child("List")))
      // Fold every card, or open every one (history included); ←/→ fold the selected card.
      .when(this.allFolds.length > 0, (el) => el.child(icon(button("ag-fold", this.anyOpen ? "Collapse all (←/→ one card)" : "Expand all (←/→ one card)",
        () => this.setFold(this.allFolds, this.anyOpen))).child(svg(ICON(this.anyOpen ? "collapse" : "unfold")).size(13))))
      .child(icon(button("ag-refresh", "Refresh git and PRs", (cx) => this.refresh(cx, true)))
        .child(svg(ICON("refresh")).size(13).when(this.busy, (el) => el.spin(900))))
      .when(this.panel, (el) => el.child(icon(button("ag-expand", "Open in window", () => run("mod.open", { name: "agent-graph" })))
        .child(svg(ICON("expand")).size(13))));
  }

  setPick(v) {
    this.pick = v;
    localStorage.setItem("view", v);
    this.view = null;
  }

  dot(t, s, size = 8) {
    return div().size(size).flex_none().rounded(size).bg(t[s] ?? t.idle)
      .when(s === "working", (el) => el.loop("opacity", BREATH)); // breathes; everything else is still
  }

  canvas(t, items, tree, L) {
    const Z = this.Z;
    let el = this.measure(div().id("ag-canvas").flex_1().min_h(0).relative().overflow_hidden().bg(t.background))
      .map((el) => (this.drag?.moved ? el.cursor_grabbing() : el.cursor_grab()))
      .on_scroll_wheel((e, cx) => {
        if (!this.fitted) return;
        const v = this.view ?? this.fitted;
        const r = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : null);
        const p = r ? { x: r.x / Z, y: r.y / Z } : { x: this.size.width / 2, y: this.size.height / 2 };
        // A mouse wheel (it reports lines) zooms, like a map; a trackpad's two-finger scroll pans; ⌘/ctrl-scroll zooms either way.
        if (e.delta_lines || e.modifiers.control || e.modifiers.platform) this.zoomAt(Math.exp((e.delta_lines ? e.delta_lines.y * 40 : e.delta.y) * 0.003), p.x, p.y);
        else this.view = { ...v, x: v.x + e.delta.x / Z, y: v.y + e.delta.y / Z };
        cx.notify();
      })
      .on_pinch((e, cx) => { // trackpad pinch zooms about the fingers
        if (!this.fitted) return;
        const r = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : null);
        this.zoomAt(1 + e.delta, r ? r.x / Z : this.size.width / 2, r ? r.y / Z : this.size.height / 2);
        cx.notify();
      })
      .on_mouse_down("left", (e) => {
        if (this.fitted) this.drag = { x: e.position.x, y: e.position.y, v: { ...(this.view ?? this.fitted) }, moved: false };
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const dx = (e.position.x - d.x) / Z, dy = (e.position.y - d.y) / Z;
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        if (d.node) {
          const v = (this.view ??= this.fitted); // pin the view: refitting mid-drag would slide everything
          this.offsets.set(d.node, { x: d.o.x + dx / v.z, y: d.o.y + dy / v.z });
        } else this.view = { ...d.v, x: d.v.x + dx, y: d.v.y + dy };
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        this.endDrag();
        cx.notify();
      })
      .on_hover((h) => { if (!h) this.endDrag(); });
    if (!this.size) return el;
    // Film grain behind everything, for depth: grain.png (512px: light and dark specks, so any theme) tiled at one image
    // px per screen px on a 2x display, still while the graph pans and zooms.
    const g = GRAIN / Z, grain = grainOpacity(shared("agent-graph.filmGrain"));
    if (grain) for (let y = 0; y < this.size.height; y += g) for (let x = 0; x < this.size.width; x += g)
      el = el.child(image("mods/agent-graph/grain.png").absolute().left(x).top(y).w(g).h(g).opacity(grain));

    const quiet = (line, hint, action) => el.child(v_flex().absolute().left(0).top(0).size_full().px(16).items_center().justify_center().gap(8)
      .child(div().text_size(13).text_color(t.muted).child(line))
      .when(!!hint, (el) => el.child(div().max_w(420).text_size(12).text_color(t.dim).text_center().child(hint)))
      .when(!!action, (el) => el.child(h_flex().id("ag-empty-action").mt(4).h(24).px(10).items_center().rounded(6).border(1).border_color(t.input)
        .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { action[1](); cx.notify(); }).child(action[0]))));
    if (!items.some((i) => i.agent)) return quiet("No agents running.", "Start an agent (Claude Code, Codex, pi…) in any terminal and it appears here. Sub-agents (hc run, Claude Code's Task, omp's task) hang off their parent.");
    if (!this.loaded) return quiet("Reading repositories…");
    if (!tree.length) return quiet("Nothing active right now.", null, ["Show all", () => { this.activeOnly = false; }]);

    this.fitted = this.fitView(L);
    const v = this.view ?? this.fitted, z = v.z, W = this.size.width, H = this.size.height;
    const X = (x) => x * z + v.x, Y = (y) => y * z + v.y;
    const layer = (path, color) => div().absolute().left(0).top(0).w(W).h(H).child(window.paint_path(path, color));
    const els = [];

    // The backdrop that moves with the drawing: Settings' Background (lib PATTERNS) at its strength.
    const strength = dotsAlpha(shared("agent-graph.dots"));
    if (strength) {
      const cards = L.nodes.map((n) => ({ x: X(n.x), y: Y(n.y), w: n.w * z, h: n.h * z }));
      for (const l of backdrop(shared("agent-graph.pattern"), W, H, z, v.x, v.y, cards, Date.now(), !!this.drag?.moved).layers) {
        const [ox, oy] = l.off ?? [0, 0];
        els.push(div().absolute().left(ox).top(oy).w(W + 400).h(H + 400).child(window.paint_path(this.backdropPath(l), alpha(t.foreground, Math.min(1, strength * l.alpha)))));
      }
    }

    // One stroke path per status colour; smooth horizontal S-curves.
    const ink = { blocked: t.blocked, done: alpha(t.done, 0.75), working: alpha(t.working, 0.75), idle: t.border };
    const paths = new Map();
    for (const e of L.edges) {
      const ax = X(e.a.x), ay = Y(e.a.y), bx = X(e.b.x), by = Y(e.b.y), mx = (bx - ax) / 2;
      const b = paths.get(e.status) ?? PathBuilder.stroke(e.status === "idle" ? 1.25 : 1.5);
      paths.set(e.status, b.move_to(ax, ay).cubic_bezier_to(bx, by, ax + mx, ay, bx - mx, by));
    }
    for (const st of [...STATUS].reverse()) if (paths.has(st)) els.push(layer(paths.get(st).build(), ink[st]));

    for (const n of L.nodes) els.push(this.node(t, n, X(n.x), Y(n.y), z));
    // On a card with something under it: a chevron on its right edge; once folded, what it hides rides on its bottom
    // edge (in the gap between rows, so folding never widens the graph). A history card is its own summary.
    for (const n of L.nodes) if (n.data.foldable) {
      const x = X(n.x), y = Y(n.y), w = n.w * z;
      els.push(this.chevron(t, n.data, z).absolute().left(x + w - 9 * z).top(y + (n.h / 2 - 9) * z).size(18 * z).rounded_full().justify_center()
        .border(1).border_color(t.border).bg(t.surface));
      if (n.data.folded && !n.data.history) els.push(h_flex().absolute().left(x + 12 * z).top(y + (n.h - 10) * z).w(w - 36 * z).justify_end()
        .child(this.summaryChip(t, n.data, z)));
    }
    // Zoom controls (pinch, ⌘/ctrl-scroll and - / = zoom too): − · the zoom (click: fit) · +.
    const zb = (id, tip, label, onClick) => h_flex().id(id).h(24).px(8).items_center().justify_center().text_size(12).text_color(t.muted)
      .cursor_pointer().tooltip(tip).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { onClick(); cx.notify(); }).child(label);
    els.push(h_flex().absolute().right(12).bottom(12).rounded(7).border(1).border_color(t.border).bg(t.surface).overflow_hidden().shadow_sm()
      .child(zb("ag-zoom-out", "Zoom out (-)", "−", () => this.zoomAt(0.8, W / 2, H / 2)))
      .child(zb("ag-zoom-fit", "Fit (F)", `${Math.round(z * 100)}%`, () => { this.view = null; }).min_w(52).border_l(1).border_r(1).border_color(t.border))
      .child(zb("ag-zoom-in", "Zoom in (=)", "+", () => this.zoomAt(1.25, W / 2, H / 2))));
    return el.children(els);
  }

  // A card at the canvas position, every length scaled by the view's zoom. Dragging a card moves just that card.
  // `tone`: the colour an agent that needs looking at is drawn in (blocked, working), else none.
  card(t, n, x, y, z, tone) {
    return v_flex().id(n.id).absolute().left(x).top(y).w(n.w * z).h(n.h * z).px(12 * z).justify_center().gap(4 * z)
      .rounded(10 * z).border(1).border_color(tone ? alpha(tone, 0.8) : t.border).bg(tone ? mix(t.background, tone, 0.08) : t.surface) // opaque: no grain through a card
      .when(this.drag?.node === n.id && this.drag.moved, (el) => el.cursor_grabbing().shadow_lg())
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        this.h.focus(); // the press stops here, so the root's focus never runs
        this.drag = { node: n.id, x: e.position.x, y: e.position.y, o: this.offsets.get(n.id) ?? { x: 0, y: 0 }, moved: false, fitted: this.view == null };
      });
  }

  // Where you are (lib's buildTree marks it here): an accent border and a soft halo.
  ring(t, el, n, z, on) {
    return !on ? el : el.border_color(t.accent).child(div().absolute().left(-4 * z).top(-4 * z).w(n.w * z + 8 * z).h(n.h * z + 8 * z)
      .rounded(13 * z).border(2).border_color(alpha(t.accent, 0.3)));
  }

  node(t, n, x, y, z) {
    const d = n.data, isFoc = !!d.here;
    if (n.kind === "repo") {
      const none = d.kind === "none";
      const meta = d.machine ?? `${d.worktrees.length} ${none ? (d.worktrees.length > 1 ? "folders" : "folder") : d.worktrees.length > 1 ? "worktrees" : "worktree"}`;
      return this.card(t, n, x, y, z)
        .when(!none, (el) => el.cursor_pointer().tooltip(`Every worktree of ${d.name}`).on_click(() => { if (!this.drag?.moved) this.worktrees(d); }))
        .child(h_flex().gap(8 * z).items_center()
          .child(svg(ICON(none ? "folder" : "repo")).size(14 * z).flex_none().text_color(t.muted))
          .child(div().min_w(0).truncate().text_size(15 * z).font_semibold().text_color(none ? t.muted : t.foreground).child(d.name)))
        .child(h_flex().gap(6 * z).items_center().text_size(11 * z).text_color(t.dim)
          .when(!!d.machine, (el) => el.child(svg(ICON("server")).size(11 * z).flex_none()))
          .child(div().min_w(0).truncate().child(meta)));
    }
    if (n.kind === "worktree") {
      const git = d.kind === "worktree";
      const ab = git && (d.ahead || d.behind) ? `${d.ahead ? `↑${d.ahead}` : ""}${d.ahead && d.behind ? " " : ""}${d.behind ? `↓${d.behind}` : ""}` : "";
      const path = git ? d.path : (d.path ?? "").replace(home(), "~");
      return this.ring(t, this.card(t, n, x, y, z), n, z, isFoc)
        .when(this.sel === d.id, (el) => el.bg(t.selected))
        .on_click((_e, cx) => { if (!this.drag?.moved) { this.sel = d.id; cx.notify(); } })
        .child(h_flex().gap(8 * z).items_center()
          .child(svg(ICON(git ? "branch" : "folder")).size(14 * z).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().text_size(13 * z).text_color(t.foreground).child(git ? d.branch ?? "detached" : d.name))
          .when(!!ab, (el) => el.child(div().flex_none().text_size(11 * z).text_color(t.dim).child(ab))))
        .child(h_flex().gap(8 * z).items_center()
          .child(this.workedBy(t, d, path, 11 * z))
          .map((el) => { const f = this.worktreeConflicts(d); return f.length ? el.child(this.warn(t, `w-${d.id}`, f, z, true)) : el; })
          .map((el) => { const total = this.totalLine(d.total); return total ? el.child(div().id(`wt-${d.id}`).flex_none().text_size(11 * z).text_color(t.muted)
            .when(d.total.estimate, (el) => el.tooltip(`${total}: everything under it\n${ESTIMATE}`)).child(total)) : el; })
          .when(!!d.pr, (el) => el.child(this.chip(t, d, z))));
    }
    if (d.history) return this.historyCard(t, n, x, y, z);
    const loud = d.status === "blocked", tone = loud ? t.blocked : d.status === "working" ? t.working : null; // working stands out too
    const sel = this.sel === d.id, line = metricLine(d.m ?? d.total), tip = this.tip(d);
    const sub = d.sub, warn = this.cardConflicts(d); // sub: an in-process sub-agent (lib subItems)
    const p = d.program;
    const icon = p?.icon ? (p.tint ? svg(p.icon).size(16 * z).flex_none().text_color(t.foreground) : image(p.icon).w(16 * z).h(16 * z).flex_none()) : null;
    return this.card(t, n, x, y, z, tone)
      .when(sel && !tone, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(tone ? mix(t.background, tone, 0.14) : sel ? t.selected : t.raised).border_color(isFoc ? t.accent : tone ?? t.input).shadow_sm())
      .on_click(() => { if (this.drag?.moved) return; if (sub) this.sel = d.id; this.open(d); }) // a pan that started on the card isn't a click
      .when(!!tip, (el) => el.tooltip(tip))
      .map((el) => this.ring(t, el, n, z, isFoc))
      .child(h_flex().gap(8 * z).items_center()
        .when(!!icon, (el) => el.child(icon))
        .child(div().flex_1().min_w(0).truncate().text_size(13 * z).font_semibold().text_color(t.foreground).child(d.name))
        .map((el) => this.branchTag(t, el, d, z, false)))
      .child(h_flex().gap(6 * z).items_center()
        .child(this.dot(t, d.status, 8 * z))
        .child(sub // "Working · Run the tests" / "Finished 4m", and its edited files' count in the dim slot
          ? div().flex_1().min_w(0).truncate().text_size(12 * z).text_color(t.muted).child(subState(sub, this.now))
          : div().flex_none().text_size(12 * z).text_color(loud ? t.blocked : t.muted).when(loud, (el) => el.font_semibold())
            .child(d.agent ? WORD[d.status] : d.kind))
        .when(warn.length > 0, (el) => el.child(this.warn(t, `w-${d.id}`, warn, z, false)))
        .child(sub ? div().flex_none().text_size(11 * z).text_color(t.dim).child(sub.edited.length ? `✎ ${sub.edited.length}` : "")
          : div().flex_1().min_w(0).truncate().text_right().text_size(11 * z).text_color(t.dim).child(d.tab ?? (d.parent ? "sub-agent" : "")))
        .when(!!line, (el) => el.child(div().flex_none().text_size(11 * z).text_color(t.dim).child(line)))); // "⚒ 66 · ≈ $1.20": its own
  }

  // An isolated sub-agent's own branch (git, not the meta's: the person may have switched it). A graph card has no room
  // for the name beside its title: the icon, the name on hover; a list row (wide) shows it.
  branchTag(t, el, d, z, named) {
    const w = d.sub?.worktree, f = w && this.git.get(key(d.machine, w))?.v, br = f?.branch;
    if (f?.gone) return el.child(h_flex().id(`br-${d.id}`).flex_none().gap(4 * z).items_center().text_size(11 * z).text_color(t.dim)
      .tooltip(`Its worktree was deleted\n${w.replace(home(), "~")}`)
      .child(svg(ICON("branch")).size(11 * z).flex_none().opacity(0.5)).when(named, (el) => el.child("worktree deleted")));
    return !br ? el : el.child(h_flex().id(`br-${d.id}`).flex_none().max_w(160 * z).gap(4 * z).items_center().text_size(11 * z).text_color(t.dim)
      .tooltip(`Works in its own worktree on ${br}\n${w.replace(home(), "~")}`)
      .child(svg(ICON("branch")).size(11 * z).flex_none()).when(named, (el) => el.child(div().min_w(0).truncate().child(br))));
  }

  // A worktree's dim line: the sub-agent working there ("↳ Ticket 2"), else its path.
  workedBy(t, w, path, size) {
    const o = this.owners.get(w.id);
    const el = div().id(`by-${w.id}`).flex_1().min_w(0).truncate().text_size(size).text_color(o?.running ? t.muted : t.dim);
    return !o ? el.child(path) : el.tooltip(`${o.running ? "Working here" : "Worked here"}: ${o.task}\nA sub-agent of ${o.agent ?? "an agent"}\n${path}`).child(`↳ ${o.task}`);
  }

  // One card for every sub-agent an agent ran that has finished: "12 earlier sub-agents", their calls and cost. A click
  // (or Enter) opens it into their cards, newest first.
  historyCard(t, n, x, y, z) {
    const d = n.data, sel = this.sel === d.id;
    return this.card(t, n, x, y, z).cursor_pointer()
      .when(sel, (el) => el.bg(t.selected))
      .hover((s) => s.bg(sel ? t.selected : t.raised).border_color(t.input).shadow_sm())
      .on_click((_e, cx) => { if (this.drag?.moved) return; this.sel = d.id; this.toggle(d); cx.notify(); })
      .tooltip(this.tip(d))
      .child(div().min_w(0).truncate().text_size(13 * z).font_semibold().text_color(t.muted).child(d.name))
      .child(h_flex().gap(6 * z).items_center()
        .child(this.dot(t, "idle", 8 * z))
        .child(div().flex_1().min_w(0).truncate().text_size(12 * z).text_color(t.muted).child(metricLine(d.total) || "Finished")));
  }

  // ---- Tool calls, cost, folding ----

  // A worktree's total, cost first: "≈ $14 · ⚒ 900".
  totalLine(t) {
    return [costLabel(t), t.tools ? `⚒ ${t.tools}` : ""].filter(Boolean).join(" · ");
  }

  // A card's hover: what a sub-agent touched, else its tab; then its calls and cost, and with what's under it.
  tip(d) {
    const head = d.sub ? this.fileTip(d.sub, d.machine) : d.history ? `${d.name}: click to ${d.folded ? "open" : "fold"}` : d.tab;
    const own = d.m && metricLine(d.m), all = d.below && (d.below.tools || d.below.tokens) ? metricLine(d.total) : "";
    return [head, own && `${own}${all ? " (its own)" : ""}`, all && `${d.history ? "" : "with sub-agents: "}${all}`,
      d.total?.estimate && ESTIMATE, d.total?.unpriced && "+: some requests had no known price"].filter(Boolean).join("\n");
  }

  // ▾ open / ▸ folded, on a card with something under it (a fixed slot in the list, so rows line up).
  chevron(t, d, z) {
    const el = h_flex().id(`fold-${d.id}`).w(12 * z).flex_none().items_center().text_size(11 * z).text_color(t.dim);
    return !d.foldable ? el : el.cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(d.folded ? "Open (→)" : "Fold (←)")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(d); cx.notify(); })
      .child(d.folded ? "▸" : "▾");
  }

  // What a folded card hides: "3 agents · 5 sub-agents · ≈ $14". A click opens it.
  summaryChip(t, d, z) {
    return h_flex().id(`sum-${d.id}`).min_w(0).h(20 * z).px(8 * z).items_center().rounded(6 * z).border(1).border_color(t.border)
      .bg(t.surface).text_size(11 * z).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(d.below.estimate ? `Open (→)\n${ESTIMATE}` : "Open (→)")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(d); cx.notify(); })
      .child(div().min_w(0).truncate().child(summary(d.below) || "Folded"));
  }

  // ---- What sub-agents touch ----

  fileName(e) {
    return e.rel ?? e.path.replace(home(), "~");
  }

  // The hover label: tooltips take plain text.
  fileTip(s, machine = null) {
    if (!s.edited.length) return `${subState(s, this.now)}\nNo files edited`;
    const more = s.edited.length - MAX_FILES;
    const where = worktreeNote(s.worktree, s.worktree && this.git.get(key(machine, s.worktree))?.v); // an isolated sub-agent's own worktree
    return [subState(s, this.now), `${s.edited.length} edited${where} · ● uncommitted`, ...s.edited.slice(0, MAX_FILES).map((e) => `${e.dirty ? "●" : "  "} ${this.fileName(e)}`),
      ...(more > 0 ? [`+${more} more`] : [])].join("\n");
  }

  // One edited file: a dot while it's still uncommitted, worktree-relative, newest first (subagents.py's order).
  file(t, e, z) {
    return h_flex().gap(6 * z).items_center().min_w(0).flex_1()
      .child(div().size(6 * z).flex_none().rounded(6 * z).when(e.dirty, (el) => el.bg(t.accent)))
      .child(div().flex_1().min_w(0).truncate().text_size(11 * z).text_color(e.dirty ? t.foreground : t.muted).child(this.fileName(e)));
  }

  // Files two agents or sub-agents in a worktree's tree both edited and haven't committed (lib overlaps); folded or not.
  worktreeConflicts(w) {
    const ids = new Set(w.ids);
    return conflictsOf(this.ov, (id) => ids.has(id));
  }

  // A card's own overlaps; a folded one also wears those of what it hides.
  cardConflicts(d) {
    return d.folded ? this.worktreeConflicts(d) : conflictsOf(this.ov, (id) => id === d.id);
  }

  // ⚠ in the blocked tone: on a card alone, on a worktree with the file (+N).
  warn(t, id, files, z, named) {
    const label = named ? `⚠ ${files[0].split("/").pop()}${files.length > 1 ? ` +${files.length - 1}` : ""}` : "⚠";
    return h_flex().id(id).flex_none().h(18 * z).px(6 * z).items_center().rounded(5 * z).border(1).border_color(alpha(t.blocked, 0.35))
      .bg(alpha(t.blocked, 0.12)).text_size(11 * z).text_color(t.blocked)
      .tooltip(`Edited by two agents and not committed:\n${files.join("\n")}`).child(label);
  }

  // Beautiful UI "tool chip": icon + state, tinted by what it means.
  chip(t, w, z) {
    const c = w.pr;
    const color = c.state === "open" ? (c.review === "changes" ? t.blocked : t.done) : c.state === "none" || c.state === "closed" ? t.dim : t.muted;
    const live = c.state !== "none";
    return h_flex().id(`pr-${w.id}`).flex_none().h(20 * z).px(8 * z).gap(4 * z).items_center().rounded(6 * z)
      .border(1).border_color(alpha(color, live ? 0.3 : 0.25)).when(live, (el) => el.bg(alpha(color, 0.1)))
      .text_size(11 * z).text_color(color)
      .when(live, (el) => el.cursor_pointer().tooltip(c.title || c.label)
        .hover((s) => s.bg(alpha(color, 0.2)))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.openPr(w); }))
      .when(live, (el) => el.child(svg(ICON(c.state === "merged" ? "merge" : "pr")).size(11 * z).flex_none()))
      .child(c.label);
  }
}

AgentGraph.prototype.list = list; // the List view (list.js): a method of this view, kept in its own file
