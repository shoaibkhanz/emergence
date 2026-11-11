// Agent graph: every live terminal as repo -> worktree (branch + PR) -> agent -> sub-agent.
// Live data re-renders; git facts (30 s) and `gh pr list` (60 s) are cached per cwd / repo.

import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, focused, exec, run, theme, settings, props, closeOverlay, setShared, home } from "herdr";
import { buildTree, layout, parseRevParse, prsByBranch, cleanTitle, RANK } from "./lib.js";

const GIT_TTL = 30000, PR_TTL = 60000;
const MONO = "Geist Mono";
const ZMIN = 0.3, ZMAX = 2, ZFIT = 1.15, PAD = 48;
const STATUS = ["blocked", "done", "working", "idle"];
const WORD = { blocked: "Blocked", done: "Done", working: "Working", idle: "Idle" };
const ICON = (f) => `mods/agent-graph/${f}.svg`;
const key = (m, p) => `${m ?? ""}|${p}`;
const alpha = (c, a) => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");
const clamp = (z) => Math.min(ZMAX, Math.max(ZMIN, z));

async function facts(on, cwd) {
  try {
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

async function pulls(on, cwd) {
  try {
    const r = await exec("gh", ["pr", "list", "--state", "all", "--limit", "100", "--json", "number,state,isDraft,headRefName,title,url,reviewDecision"], { cwd, on });
    return r.code === 0 ? prsByBranch(JSON.parse(r.stdout)) : null;
  } catch {
    return null;
  }
}

export default class AgentGraph extends View {
  init(_props, cx) {
    this.git = new Map(); // machine|cwd -> { at, v: facts | null }
    this.prs = new Map(); // machine|common -> { at, v: Map | null }
    this.busy = false;
    this.loaded = false;
    this.activeOnly = localStorage.getItem("activeOnly") === "1";
    this.view = null; // { x, y, z } once the person pans or zooms; null = fitted
    this.sel = null;
    this.h = cx.focus_handle();
    this.h.focus();
    cx.timer.after(300, () => this.h.focus());
    cx.timer.every(GIT_TTL, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  // Every live terminal, flattened from agents / panes / spaces.
  items() {
    const ag = new Map(agents().map((a) => [a.address, a]));
    const pane = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p]));
    const tabs = new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, `${s.name} / ${t.name}`])));
    return terminals().filter((x) => x.state === "live").map((x) => {
      const a = ag.get(x.address), machine = x.address.includes("/") ? x.address.split("/")[0] : null;
      const lbl = x.labels?.["herdr.tab"];
      // A sub-agent without a pane reports to its parent: its done is the parent's news.
      let s = a?.status ?? (x.status === "error" ? "blocked" : x.status === "done" ? "idle" : x.status);
      const cwd = pane.get(x.address)?.cwd ?? x.foreground?.cwd ?? x.cwd ?? null;
      const agent = !!(a || x.report || x.program?.agent);
      const program = a?.program ?? x.program;
      return {
        id: x.address, parent: x.parent ?? null, machine, cwd, agent, program,
        status: s in RANK ? s : "idle",
        name: cleanTitle(a?.title || x.title || x.name) || (agent ? program?.name : cwd?.split("/").filter(Boolean).pop()) || x.address,
        kind: agent ? null : x.foreground?.name ?? program?.name ?? "terminal",
        tab: tabs.get(a?.tab ?? (lbl && machine ? `${machine}/${lbl}` : lbl)) ?? null,
      };
    });
  }

  refresh(cx, force = false) {
    if (this.busy) return;
    this.busy = true;
    const items = this.items();
    cx.spawn(async (cx) => {
      try {
        const now = Date.now(), stale = (c, ttl) => force || !c || now - c.at >= ttl;
        const cwds = new Map(items.filter((i) => i.cwd).map((i) => [key(i.machine, i.cwd), i]));
        await Promise.all([...cwds].filter(([k]) => stale(this.git.get(k), GIT_TTL))
          .map(async ([k, i]) => this.git.set(k, { at: now, v: await facts(i.machine, i.cwd) })));
        this.loaded = true;
        cx.notify();
        const repos = new Map();
        for (const [k, i] of cwds) {
          const v = this.git.get(k)?.v;
          if (v) repos.set(key(i.machine, v.common), { on: i.machine, top: v.top });
        }
        await Promise.all([...repos].filter(([k]) => stale(this.prs.get(k), PR_TTL))
          .map(async ([k, r]) => this.prs.set(k, { at: now, v: await pulls(r.on, r.top) })));
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  focusAgent(n) {
    run("agent.focus", { terminal: n.id });
    this.dismiss();
  }

  // Cross-mod deep link: pr-review picks this up (if < 30 s old) and selects the PR.
  openPr(w, cx) {
    setShared("pr-review.open", { repo: w.top, machine: w.machine, number: w.pr.number, at: Date.now() });
    cx.spawn(async () => {
      const s = await exec("herdr-app", ["status"]).catch(() => null);
      let open = false;
      try { open = JSON.parse(s?.stdout ?? "{}").overlays?.includes("pr-review"); } catch {}
      if (!open) run("mod.open", { name: "pr-review" });
      this.dismiss();
    });
  }

  fitView(L) {
    const W = this.size.width, H = this.size.height;
    const z = clamp(Math.min(ZFIT, (W - 2 * PAD) / Math.max(1, L.width), (H - 2 * PAD) / Math.max(1, L.height)));
    return { z, x: (W - L.width * z) / 2, y: Math.max(PAD, (H - L.height * z) / 2) };
  }

  zoomAt(f, px, py) {
    const v = this.view ?? this.fitted, z = clamp(v.z * f), k = z / v.z;
    this.view = { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
  }

  render(cx) {
    const t = theme();
    this.Z = Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1;
    const items = this.items();
    if (!this.busy && items.some((i) => i.cwd && !this.git.has(key(i.machine, i.cwd)))) this.refresh(cx);
    const tree = buildTree(items, (m, c) => this.git.get(key(m, c))?.v ?? null, (m, c) => this.prs.get(key(m, c))?.v ?? undefined, { activeOnly: this.activeOnly });
    const L = layout(tree);
    const picks = L.nodes.filter((n) => n.kind === "agent").sort((a, b) => a.y - b.y || a.x - b.x);
    const foc = focused()?.terminal ?? null;
    if (!picks.some((n) => n.data.id === this.sel)) this.sel = (picks.find((n) => n.data.id === foc) ?? picks[0])?.data.id ?? null;

    // A popup is as tall as its content (mod.json height is the cap): size to the window.
    return v_flex().id("ag-root").w_full().h(window.viewport_size().height * 0.88 / this.Z).bg(t.surface).text_size(13).text_color(t.foreground)
      .track_focus(this.h)
      .on_key_down((e, cx) => {
        const k = e.key, i = picks.findIndex((n) => n.data.id === this.sel);
        if (k === "escape") return this.dismiss();
        if (k === "f") this.view = null;
        else if ((k === "down" || k === "up") && picks.length) this.sel = picks[(i + (k === "down" ? 1 : picks.length - 1)) % picks.length].data.id;
        else if (k === "enter" && i >= 0) return this.focusAgent(picks[i].data);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(this.header(t, items))
      .child(this.canvas(t, items, tree, L, foc));
  }

  header(t, items) {
    const counts = STATUS.map((s) => [s, items.filter((i) => i.agent && i.status === s).length]).filter(([, n]) => n);
    const button = (id, tip, onClick) => h_flex().id(id).h(24).px(8).gap(6).items_center().rounded(6).flex_none()
      .border(1).border_color(t.border).text_size(12).text_color(t.muted).cursor_pointer().tooltip(tip)
      .hover((s) => s.bg(t.hover).border_color(t.input).text_color(t.foreground))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); });
    const on = this.activeOnly;
    return h_flex().h(40).flex_none().px(16).gap(12).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(15).font_semibold().child("Agents"))
      .child(h_flex().gap(6).items_center().children(counts.map(([s, n]) => h_flex().h(20).px(8).gap(6).items_center().rounded(6)
        .bg(s === "blocked" ? alpha(t.blocked, 0.14) : t.raised).text_size(11).text_color(s === "blocked" ? t.blocked : t.muted)
        .child(this.dot(t, s, 6)).child(`${n} ${s}`))))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child("↑↓ select · ↵ focus · F fit · Esc close"))
      .child(button("ag-active", "Hide idle agents and terminals", () => {
        this.activeOnly = !on;
        localStorage.setItem("activeOnly", on ? "0" : "1");
        this.view = null;
      }).when(on, (el) => el.text_color(t.foreground))
        .child(div().size(12).flex_none().flex().items_center().justify_center().rounded(3).border(1)
          .border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent))
          .when(on, (el) => el.child(svg(ICON("check")).size(10).text_color(t.accent_foreground))))
        .child("Active only"))
      .child(button("ag-refresh", "Refresh git and PRs", (cx) => this.refresh(cx, true)).w(24).px(0).justify_center()
        .child(svg(ICON("refresh")).size(13).when(this.busy, (el) => el.spin(900))));
  }

  dot(t, s, size = 8) {
    return div().size(size).flex_none().rounded(size).bg(t[s] ?? t.idle)
      .when(s === "working", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1400 }));
  }

  canvas(t, items, tree, L, foc) {
    const Z = this.Z;
    if (this.raw) this.size = { width: this.raw.width / Z, height: this.raw.height / Z };
    const el = div().id("ag-canvas").flex_1().min_h(0).relative().overflow_hidden().bg(t.background)
      .when(!!this.drag?.moved, (el) => el.cursor_grabbing())
      .on_size_change((s, cx) => {
        const r = this.raw;
        if (r && Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5) return;
        this.raw = { width: s.width, height: s.height };
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => {
        if (!this.fitted) return;
        const v = this.view ?? this.fitted;
        const r = e.local_position ?? (e.bounds ? { x: e.position.x - e.bounds.x, y: e.position.y - e.bounds.y } : null);
        const p = r ? { x: r.x / Z, y: r.y / Z } : { x: this.size.width / 2, y: this.size.height / 2 };
        if (e.modifiers.control || e.modifiers.platform) this.zoomAt(Math.exp(e.delta.y * 0.003), p.x, p.y);
        else this.view = { ...v, x: v.x + e.delta.x / Z, y: v.y + e.delta.y / Z };
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
        this.view = { ...d.v, x: d.v.x + dx, y: d.v.y + dy };
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        this.drag = null;
        cx.notify();
      })
      .on_hover((h) => { if (!h) this.drag = null; });
    if (!this.size) return el;

    const quiet = (line, hint, action) => el.child(v_flex().absolute().left(0).top(0).size_full().items_center().justify_center().gap(8)
      .child(div().text_size(13).text_color(t.muted).child(line))
      .when(!!hint, (el) => el.child(div().max_w(420).text_size(12).text_color(t.dim).text_center().child(hint)))
      .when(!!action, (el) => el.child(h_flex().id("ag-empty-action").mt(4).h(24).px(10).items_center().rounded(6).border(1).border_color(t.input)
        .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { action[1](); cx.notify(); }).child(action[0]))));
    if (!items.some((i) => i.agent)) return quiet("No agents running.", "Start an agent (Claude Code, Codex, pi…) in any terminal and it appears here. Sub-agents started with hc run hang off their parent.");
    if (!this.loaded) return quiet("Reading repositories…");
    if (!tree.length) return quiet("Nothing active right now.", null, ["Show idle", () => { this.activeOnly = false; localStorage.setItem("activeOnly", "0"); }]);

    this.fitted = this.fitView(L);
    const v = this.view ?? this.fitted, z = v.z, W = this.size.width, H = this.size.height;
    const X = (x) => x * z + v.x, Y = (y) => y * z + v.y;
    const layer = (path, color) => div().absolute().left(0).top(0).w(W).h(H).child(window.paint_path(path, color));
    const els = [];

    // Dot grid that moves with the drawing.
    let s = 24 * z;
    while (s < 14) s *= 2;
    while (s > 40) s /= 2;
    const ox = ((v.x % s) + s) % s, oy = ((v.y % s) + s) % s, d = 1.5;
    let grid = PathBuilder.stroke(d).dash_array([d, s - d]);
    for (let y = oy; y < H; y += s) grid = grid.move_to(ox - d / 2, y).line_to(W + s, y);
    els.push(layer(grid.build(), alpha(t.foreground, 0.07)));

    // One stroke path per status colour; smooth horizontal S-curves.
    const ink = { blocked: t.blocked, done: alpha(t.done, 0.75), working: alpha(t.working, 0.75), idle: t.border };
    const paths = new Map();
    for (const e of L.edges) {
      const ax = X(e.a.x), ay = Y(e.a.y), bx = X(e.b.x), by = Y(e.b.y), mx = (bx - ax) / 2;
      const b = paths.get(e.status) ?? PathBuilder.stroke(e.status === "idle" ? 1.25 : 1.5);
      paths.set(e.status, b.move_to(ax, ay).cubic_bezier_to(bx, by, ax + mx, ay, bx - mx, by));
    }
    for (const st of [...STATUS].reverse()) if (paths.has(st)) els.push(layer(paths.get(st).build(), ink[st]));

    for (const n of L.nodes) els.push(this.node(t, n, X(n.x), Y(n.y), z, foc));
    return el.children(els);
  }

  // A card at the canvas position, every length scaled by the view's zoom.
  card(t, n, x, y, z, loud) {
    return v_flex().id(n.id).absolute().left(x).top(y).w(n.w * z).h(n.h * z).px(12 * z).justify_center().gap(4 * z)
      .rounded(10 * z).border(1).border_color(loud ? alpha(t.blocked, 0.8) : t.border).bg(loud ? alpha(t.blocked, 0.08) : t.surface)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  }

  node(t, n, x, y, z, foc) {
    const d = n.data;
    if (n.kind === "repo") {
      const none = d.kind === "none";
      const meta = d.machine ?? `${d.worktrees.length} ${none ? (d.worktrees.length > 1 ? "folders" : "folder") : d.worktrees.length > 1 ? "worktrees" : "worktree"}`;
      return this.card(t, n, x, y, z)
        .child(h_flex().gap(8 * z).items_center()
          .child(svg(ICON(none ? "folder" : "repo")).size(14 * z).flex_none().text_color(t.muted))
          .child(div().min_w(0).truncate().text_size(15 * z).font_semibold().text_color(none ? t.muted : t.foreground).child(d.name)))
        .child(h_flex().gap(6 * z).items_center().text_size(11 * z).text_color(t.dim)
          .when(!!d.machine, (el) => el.child(svg(ICON("server")).size(11 * z).flex_none()))
          .child(div().min_w(0).truncate().when(!!d.machine, (el) => el.font_family(MONO)).child(meta)));
    }
    if (n.kind === "worktree") {
      const git = d.kind === "worktree";
      const ab = git && (d.ahead || d.behind) ? `${d.ahead ? `↑${d.ahead}` : ""}${d.ahead && d.behind ? " " : ""}${d.behind ? `↓${d.behind}` : ""}` : "";
      const path = git ? d.path : (d.path ?? "").replace(home(), "~");
      return this.card(t, n, x, y, z)
        .child(h_flex().gap(8 * z).items_center()
          .child(svg(ICON(git ? "branch" : "folder")).size(14 * z).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().text_size(13 * z).font_family(MONO).text_color(t.foreground).child(git ? d.branch ?? "detached" : d.name))
          .when(!!ab, (el) => el.child(div().flex_none().text_size(11 * z).font_family(MONO).text_color(t.dim).child(ab))))
        .child(h_flex().gap(8 * z).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11 * z).font_family(MONO).text_color(t.dim).child(path))
          .when(!!d.pr, (el) => el.child(this.chip(t, d, z))));
    }
    const loud = d.status === "blocked";
    const sel = this.sel === d.id, isFoc = foc === d.id;
    const p = d.program;
    const icon = p?.icon ? (p.tint ? svg(p.icon).size(16 * z).flex_none().text_color(t.foreground) : image(p.icon).w(16 * z).h(16 * z).flex_none()) : null;
    return this.card(t, n, x, y, z, loud)
      .when(sel && !loud, (el) => el.bg(t.selected))
      .when(isFoc, (el) => el.border_color(t.accent))
      .cursor_pointer()
      .hover((s) => s.bg(loud ? alpha(t.blocked, 0.14) : sel ? t.selected : t.raised).border_color(isFoc ? t.accent : loud ? t.blocked : t.input).shadow_sm())
      .on_click((_e) => this.focusAgent(d))
      .when(isFoc, (el) => el.child(div().absolute().left(-4 * z).top(-4 * z).w(n.w * z + 8 * z).h(n.h * z + 8 * z)
        .rounded(13 * z).border(2).border_color(alpha(t.accent, 0.3))))
      .child(h_flex().gap(8 * z).items_center()
        .when(!!icon, (el) => el.child(icon))
        .child(div().flex_1().min_w(0).truncate().text_size(13 * z).font_semibold().text_color(t.foreground).child(d.name)))
      .child(h_flex().gap(6 * z).items_center()
        .child(this.dot(t, d.status, 8 * z))
        .child(div().flex_none().text_size(12 * z).text_color(loud ? t.blocked : t.muted).when(loud, (el) => el.font_semibold())
          .child(d.agent ? WORD[d.status] : d.kind))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(11 * z).text_color(t.dim).child(d.tab ?? (d.parent ? "sub-agent" : ""))));
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
        .on_click((_e, cx) => { cx.stop_propagation(); this.openPr(w, cx); }))
      .when(live, (el) => el.child(svg(ICON(c.state === "merged" ? "merge" : "pr")).size(11 * z).flex_none()))
      .child(c.label);
  }
}
