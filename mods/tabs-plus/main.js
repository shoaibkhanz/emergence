import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand, agents, focused, exec, appHome } from "herdr";

// Herdr's tab bar plus the Emergence panels beside Files and Changes.
// [layout block id in panel-body, label, icon, default panel width px]
const PANELS = [
  ["files", "Files", "mods/files/file.svg", 368],
  ["changes", "Changes", "mods/changes/changes.svg", 368],
  ["graph", "Agents", "mods/tabs-plus/graph.svg", 620],
  ["prs", "PRs", "mods/tabs-plus/pr.svg", 860],
  ["skills", "Library", "mods/tabs-plus/skills.svg", 440],
  ["usage", "Usage", "mods/tabs-plus/usage.svg", 760],
];
const OURS = PANELS.slice(2).map(([id]) => id);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// ⌘⇧J: the next agent that needs you, blocked ones before done ones, after the one you're on.
// The tab bar always shows, so the key works with the sidebar collapsed.
function nextAttention() {
  const all = agents(), want = [...all.filter((a) => a.status === "blocked"), ...all.filter((a) => a.status === "done")];
  const i = want.findIndex((a) => a.address === focused()?.terminal);
  if (want.length) run("agent.focus", { terminal: want[(i + 1) % want.length].address });
}

// ⌘B (emergence only): the sidebar folds to a 14px strip where the inbox shows only a dot per agent that
// needs you (brand, Spaces and footer hide), and back. Herdr's ⌘B hides it outright. A hidden one comes back.
function rail() {
  const s = find(layout(), "sidebar");
  if (!s) return;
  if (s.hidden) return run("layout.show", { id: "sidebar" });
  const narrow = (s.size?.px ?? Infinity) < 160;
  if (!narrow) setShared("sidebar.width", s.size?.px);
  for (const id of ["brand", "spaces", "sidebar-footer"]) run(narrow ? "layout.show" : "layout.hide", { id });
  run("layout.resize", { id: "sidebar", px: narrow ? (shared("sidebar.width") ?? 268) : 14 });
}

// Updates. The curl install links every mod into a clone of this repo, so this mod can find it: every 6 h it
// fetches main, and when main has moved an Update chip pulls it, reruns install.sh (new mods, keys, layouts) and,
// if a layout file changed, reloads the layout (switching to the shown layout is a no-op, so via main).
// No clone (copied by hand), a fork, another branch or local commits: no chip; that clone is its owner's.
// Fetches use the public URL into origin/main, so an ssh origin never asks for a key passphrase.
const ORIGIN = /github\.com[:/]shoaibkhanz\/(emergence|herdr_mods)(\.git)?$/;
const FETCH = ["fetch", "--quiet", "https://github.com/shoaibkhanz/emergence", "+main:refs/remotes/origin/main"];
async function git(dir, ...args) {
  const r = await exec("git", ["-C", dir, ...args], { timeout: 60000 });
  if (r.code !== 0) throw 0;
  return r.stdout.trim();
}
// EMERGENCE_UPDATE stops install.sh checking mods and switching layouts; the layout reloads only if it's showing.
const UPDATE = `set -e; d="$1"
[ "$(git -C "$d" symbolic-ref -q --short HEAD)" = main ] || { echo "error: not on main" >&2; exit 1; }
old="$(git -C "$d" rev-parse HEAD)"
git -C "$d" ${FETCH.join(" ")}
git -C "$d" merge --ff-only --quiet origin/main
EMERGENCE_UPDATE=1 bash "$d/install.sh" >/dev/null
if ! git -C "$d" diff --quiet "$old" HEAD -- layouts && herdr-app status 2>/dev/null | grep -q '"layout": "emergence"'; then
  herdr-app do layout.switch --name main >/dev/null; sleep 1; herdr-app do layout.switch --name emergence >/dev/null
fi`;

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.widths = JSON.parse(localStorage.getItem("widths") ?? "{}");
    // keys.json: "cmd-shift-g": "tabs-plus.graph" toggles that panel; "tabs-plus.attention" jumps (⌘⇧J); "tabs-plus.rail" (⌘B);
    // "tabs-plus.worktrees" (⌘⇧O) lists every worktree of the repo you're in, in Herdr's own dialog (Enter opens one as a space);
    // "tabs-plus.update" applies a pending update (the chip's click).
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c === "attention") nextAttention(); else if (c === "rail") rail(); else if (c === "update") this.applyUpdate(cx); else if (c === "worktrees") openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: focused()?.space, folder: focused()?.cwd, action: "open" } }); else if (PANELS.some(([id]) => id === c)) this.toggle(c); cx.notify(); } });
    this.update = null; // { behind, busy?, error? } once main has commits this clone lacks
    cx.spawn(async (cx) => { await cx.sleep(16); this.checkUpdate(cx); }); // host calls before the first frame never resolve
    cx.timer.every(6 * 3600000, (cx) => this.checkUpdate(cx));
  }

  checkUpdate(cx) {
    cx.spawn(async (cx) => {
      try {
        const [dir, branch] = (await git(`${appHome()}/mods/tabs-plus`, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD")).split("\n");
        if (branch !== "main" || !ORIGIN.test(await git(dir, "remote", "get-url", "origin"))) {
          if (!this.update?.busy) this.update = null;
          return cx.notify();
        }
        await git(dir, ...FETCH);
        const [ahead, behind] = (await git(dir, "rev-list", "--left-right", "--count", "HEAD...origin/main")).split(/\s+/).map(Number);
        this.repo = dir;
        if (!this.update?.busy) this.update = behind && !ahead ? { behind } : null;
        cx.notify();
      } catch { /* offline or no clone: the next check tries again */ }
    });
  }

  // One shell, so the pull, relink and reload finish even if the pull reloads this mod mid-way.
  applyUpdate(cx) {
    const u = this.update;
    if (!u || u.busy || !this.repo) return;
    this.update = { behind: u.behind, busy: true };
    cx.spawn(async (cx) => {
      const r = await exec("bash", ["-c", UPDATE, "update", this.repo], { timeout: 300000 }).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      const lines = (r.stderr ?? "").trim().split("\n"), why = (lines.find((l) => /^(error|fatal): /.test(l))?.replace(/^\w+: /, "") ?? lines.pop())?.replace(/:$/, "");
      this.update = r.code === 0 ? null : { behind: u.behind, error: why || `exited ${r.code}` };
      cx.notify();
    });
  }

  // Each panel keeps its own width: what the person last dragged it to, else its default.
  remember(panel, body) {
    const px = panel?.size?.px;
    if (panel && !panel.hidden && body?.active && px) {
      this.widths[body.active] = px;
      localStorage.setItem("widths", JSON.stringify(this.widths));
    }
  }

  show(id) {
    run("layout.select", { stack: "panel-body", child: id });
    run("layout.resize", { id: "panel", px: this.widths[id] ?? PANELS.find(p => p[0] === id)?.[3] ?? 368 });
    run("layout.show", { id: "panel" });
  }

  toggle(id) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body?.children?.some(c => c.id === id)) return;
    this.remember(panel, body);
    if (!panel.hidden && body.active === id) run("layout.hide", { id: "panel" });
    else this.show(id);
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          this.remember(panel, body);
          if (want) this.show(want);
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = (space?.tabs ?? []).filter(tab => !tab.settled || tab.active); // settled: on the inbox's shelf (the shown one stays)
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const blocks = new Set((body?.children ?? []).map(c => c.id));
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), ...OURS].filter(id => blocks.has(id));
    this.syncPanel(space, panel, body, enabled);
    const panelButton = ([id, label, icon]) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => this.toggle(id)).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .children(PANELS.filter(([id]) => enabled.includes(id)).map(panelButton))
      .when(Boolean(this.update), (el) => {
        const u = this.update, ink = u.error ? t.blocked : t.accent;
        return el.child(h_flex().id("emergence-update").h(26).px(8).gap(6).flex_none().items_center().rounded(6).text_size(12).text_color(ink)
          .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => { this.applyUpdate(cx); cx.notify(); })
          .tooltip(u.busy ? "Pulling Emergence and relinking its mods…" : u.error ? `Update failed: ${u.error}. Click to try again.` : `Emergence has ${u.behind} new commit${u.behind === 1 ? "" : "s"} on GitHub. Click to update.`)
          .child(div().size(6).rounded(3).flex_none().bg(ink)).child(u.busy ? "Updating…" : u.error ? "Update failed" : "Update"));
      })
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-plus/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-plus/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-plus/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
