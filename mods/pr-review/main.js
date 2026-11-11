// PR review: a floating window (mod.json overlay kind "window"), or a side-panel
// block (props { panel: true }), that follows the focused pane's repo. Left rail: this branch vs the default branch, then the
// repo's PRs (search, Open · Closed · All). Main: changed files and one
// continuous unified diff, drawn only where it is on screen, with GitHub review
// threads inline under their lines. Click / shift-click / drag selects lines on
// one side; ⌘Enter posts a review comment on them.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { exec, focused, panes, spaces, theme, settings, props, shared, setShared, closeOverlay, run, layout } from "herdr";
import * as gh from "./github.js";
import { parseDiff, selectRange, commentPayload, anchorThreads, ago, firstVisible } from "./lib.js";

const MONO = "Geist Mono";
const icon = (name) => svg(`mods/pr-review/${name}.svg`);
const tint = (c, a) => c.slice(0, 7) + a;
const H = { file: 40, row: 20, hunk: 28, note: 36, gap: 16, thread: 132, resolved: 44, composer: 180 };
const GUTTER = 104; // two line-number columns + sign: cards and notes line up with the code
const STATES = [["open", "Open"], ["closed", "Closed"], ["all", "All"]];
const BLOCK = "prs"; // this mod's block id in the layout's panel-body stack
const NARROW = 760; // panel width below which it drills down: list → PR → diff

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

async function git(id, args) {
  const r = await exec("git", args, { cwd: id.repo, on: id.machine });
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout;
}

export default class PrReview extends View {
  init(_props, cx) {
    this.panel = props()?.panel === true;
    this.repos = new Map(); // "machine|toplevel" → per-repo state, kept while the window is open
    this.cur = null; // the shown repo's state, or { none: message }
    this.heights = new Map(); // measured thread / composer heights
    this.expanded = new Set(); // resolved threads opened by hand
    this.filesOpen = null; // null: shown when there is room
    this.handle = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search pull requests" });
    this.search.on("focus", () => (this.inSearch = true));
    this.search.on("blur", () => (this.inSearch = false));
    this.search.on("change", (_e, cx) => {
      const s = this.cur;
      if (!s?.id || this.search.value() === s.search) return;
      s.search = this.search.value();
      const seq = (this.searchSeq = (this.searchSeq ?? 0) + 1);
      cx.timer.after(350, (cx) => seq === this.searchSeq && this.loadPRs(s, cx));
    });
    this.composer = this.textarea("Leave a comment", (cx) => this.post(cx));
    // A hidden panel skips polling and catches up when shown again.
    cx.timer.every(60000, (cx) => (this.shown() ? this.poll(this.cur, cx) : (this.stale = true)));
    if (this.panel) return;
    this.handle.focus();
    cx.timer.after(150, () => this.handle.focus());
  }

  shown() {
    if (!this.panel) return true;
    const root = layout(), panel = find(root, "panel");
    return Boolean(panel) && !panel.hidden && find(root, "panel-body")?.active === BLOCK; // a shown panel has no `hidden` key
  }

  poll(s, cx) {
    if (!s?.info) return;
    this.loadPRs(s, cx, true);
    if (typeof s.entry === "number") this.loadThreads(s, s.entry, cx);
  }

  // A Textarea that submits on ⌘Enter and keeps the rail's keys away while focused.
  textarea(placeholder, submit, value) {
    const st = TextareaState.new({ placeholder, value, rows: 3 });
    st.on("focus", () => (this.typing = true));
    st.on("blur", () => (this.typing = false));
    st.on("submit", (e, cx) => e.secondary && !e.shift && submit(cx));
    return st;
  }

  dismiss() { closeOverlay(props().overlay); }

  // Panel → the window, carrying the open PR over.
  expand() {
    const s = this.cur;
    if (typeof s?.entry === "number") {
      this.handledAt = Date.now();
      setShared("pr-review.open", { repo: s.id.repo, machine: s.id.machine, number: s.entry, at: this.handledAt });
    }
    run("mod.open", { name: "pr-review" });
  }

  back(s) { s.level = s.level === "diff" ? "pr" : "list"; }

  // ---- target: the focused pane's repo, or a deep link ----

  focusInfo() {
    const f = focused();
    const cwd = f && (f.cwd ?? (f.pane && panes().find((p) => p.pane === f.pane)?.cwd));
    return cwd ? { dir: cwd, machine: spaces().find((s) => s.id === f.space)?.machine ?? null } : null;
  }

  syncTarget(cx) {
    const f = this.focusInfo();
    const fk = f && `${f.machine}|${f.dir}`;
    const req = shared("pr-review.open");
    if (req?.at && req.at !== this.handledAt && Date.now() - req.at < 30000) {
      this.handledAt = req.at;
      this.pin = { dir: req.repo, machine: req.machine ?? null, number: req.number, at: req.at, focus: fk };
      cx.spawn(async () => setShared("pr-review.open", null));
    }
    if (this.pin && f && fk !== this.pin.focus) this.pin = null;
    const want = this.pin ?? f;
    if (!want) return;
    const key = `${want.machine}|${want.dir}|${want.at ?? ""}`;
    if (key === this.wantKey) return;
    this.wantKey = key;
    cx.spawn(async (cx) => {
      await cx.sleep(16); // host calls started before a copy's first frame never resolve
      const top = (await git({ repo: want.dir, machine: want.machine }, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim();
      if (this.wantKey !== key) return;
      if (!top) { this.cur = { none: "This folder isn't a git repository." }; cx.notify(); return; }
      const rk = `${want.machine}|${top}`;
      let s = this.repos.get(rk);
      if (!s) {
        s = { id: { repo: top, machine: want.machine }, name: top.split("/").pop(), state: "open", search: "", diffs: new Map(), scroll: {}, entry: null, cursor: 0 };
        this.repos.set(rk, s);
        this.loadRepo(s, cx, want.number);
      } else if (want.number) this.open(s, want.number, cx);
      if (want.number) s.level = "pr";
      this.cur = s;
      if (this.repoll) { this.repoll = false; this.poll(s, cx); }
      this.search.set_value(s.search);
      cx.notify();
    });
  }

  // ---- reads ----

  loadRepo(s, cx, number) {
    s.loading = true;
    cx.spawn(async (cx) => {
      s.branch = (await git(s.id, ["branch", "--show-current"]).catch(() => "")).trim() || "detached HEAD";
      try {
        s.info = await gh.repoInfo(s.id);
        s.info.defaultBranch ??= (await git(s.id, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "main")).trim().replace(/^origin\//, "");
      } catch (e) {
        s.error = /remote|not a github|no known/i.test(e.message) ? "No GitHub remote for this repository." : e.message;
      }
      s.loading = false;
      if (s.info) { this.loadPRs(s, cx); if (number) this.open(s, number, cx); }
      cx.notify();
    });
  }

  loadPRs(s, cx, quiet) {
    if (!quiet) s.prsLoading = true;
    const ask = `${s.state}|${s.search}`;
    cx.spawn(async (cx) => {
      try {
        const prs = await gh.listPRs(s.id, s.state, s.search.trim());
        if (ask !== `${s.state}|${s.search}`) return;
        const rank = (p) => (p.state === "OPEN" ? 0 : 1);
        s.prs = prs.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
        s.prsError = null;
      } catch (e) { s.prsError = e.message; }
      s.prsLoading = false;
      cx.notify();
    });
  }

  open(s, entry, cx, reload) {
    if (s.entry !== entry) { s.entry = entry; s.sel = null; this.dropDraft(); this.composeError = null; }
    const d = s.diffs.get(entry) ?? {};
    d.pr = s.prs?.find((p) => p.number === entry) ?? d.pr; // kept so the header survives filtering the PR out of the list
    if (s.diffs.has(entry) && !reload) return;
    d.loading = true;
    s.diffs.set(entry, d);
    cx.spawn(async (cx) => {
      try {
        let text;
        if (entry === "local") {
          const base = s.info.defaultBranch;
          const mb = (await git(s.id, ["merge-base", `origin/${base}`, "HEAD"]).catch(() => git(s.id, ["merge-base", base, "HEAD"]))).trim();
          text = await git(s.id, ["diff", "--no-color", "--no-ext-diff", mb]);
        } else text = await gh.prDiff(s.id, entry);
        d.files = parseDiff(text);
        d.error = null;
      } catch (e) { d.error = e.message; }
      d.loading = false;
      cx.notify();
    });
    if (entry === "local") return;
    this.loadThreads(s, entry, cx);
    if (!d.pr) cx.spawn(async (cx) => { d.pr = await gh.viewPR(s.id, entry).catch(() => null); cx.notify(); });
  }

  async fetchThreads(s, n) {
    const d = s.diffs.get(n);
    try {
      const r = await gh.threads(s.id, s.info.nwo, n);
      Object.assign(d, { headOid: r.headOid, threads: r.threads, threadsError: null });
    } catch (e) { d.threadsError = e.message; }
  }

  loadThreads(s, n, cx) { cx.spawn(async (cx) => { await this.fetchThreads(s, n); cx.notify(); }); }

  refresh(cx) {
    const s = this.cur;
    if (!s?.id) return;
    if (!s.info) { s.error = null; this.loadRepo(s, cx); return; }
    this.loadPRs(s, cx);
    if (s.entry != null) this.open(s, s.entry, cx, true);
  }

  // ---- writes: never retried, errors stay inline ----

  post(cx) {
    const s = this.cur, d = s?.diffs.get(s.entry), f = s?.sel && d?.files[s.sel.fi];
    const body = this.composer.value().trim();
    if (!f || !body || this.posting || !d.headOid) return;
    const where = commentPayload(f.path, selectRange(f.rows, s.sel.anchor, s.sel.focus));
    this.posting = true;
    this.composeError = null;
    cx.spawn(async (cx) => {
      try {
        await gh.createComment(s.id, s.info.nwo, s.entry, { body, commit_id: d.headOid, ...where });
        this.composer.set_value("");
        s.sel = null;
        await this.fetchThreads(s, s.entry);
      } catch (e) { this.composeError = e.message; }
      this.posting = false;
      cx.notify();
    });
    cx.notify();
  }

  // One thread write: busy while it runs, then its error or the fresh threads.
  act(th, fn, cx, after) {
    const s = this.cur;
    if (this.busy) return;
    this.busy = th.id;
    this.actError = null;
    cx.spawn(async (cx) => {
      try { await fn(s.info.nwo); after?.(); await this.fetchThreads(s, s.entry); }
      catch (e) { this.actError = { thread: th.id, msg: e.message }; }
      this.busy = null;
      cx.notify();
    });
    cx.notify();
  }

  startDraft(kind, th, c) {
    this.dropDraft();
    const state = this.textarea(kind === "reply" ? "Reply" : "Edit comment", (cx) => this.saveDraft(cx), kind === "edit" ? c.body : "");
    this.draft = { kind, thread: th.id, comment: c?.databaseId, state };
    state.focus();
  }

  dropDraft() { this.draft?.state.release(); this.draft = null; this.typing = false; }

  saveDraft(cx) {
    const dr = this.draft, s = this.cur;
    const body = dr?.state.value().trim();
    const th = body && s.diffs.get(s.entry).threads.find((x) => x.id === dr.thread);
    if (!th) return;
    this.act(th, (nwo) => (dr.kind === "reply" ? gh.reply(s.id, nwo, s.entry, th.comments[0].databaseId, body) : gh.editComment(s.id, nwo, dr.comment, body)), cx,
      () => this.draft === dr && this.dropDraft());
  }

  // ---- input ----

  key(e, cx) {
    const s = this.cur?.info ? this.cur : null;
    const k = e.key;
    if (k === "escape") {
      if (this.draft) this.dropDraft();
      else if (this.confirm) this.confirm = null;
      else if (s?.sel) { s.sel = null; this.typing = false; }
      else if (!this.panel) return this.dismiss();
      else if (this.narrow && s?.entry != null && (s.level ?? "list") !== "list") this.back(s);
      else return;
    } else if (this.typing) return;
    else if (k === "/" && !this.inSearch) this.search.focus();
    else if (s && (k === "up" || k === "down")) {
      const n = 1 + (s.prs?.length ?? 0);
      s.cursor = (s.cursor + (k === "down" ? 1 : n - 1)) % n;
    } else if (s && k === "enter") {
      const entry = s.cursor === 0 ? "local" : s.prs?.[s.cursor - 1]?.number;
      if (entry != null) { this.open(s, entry, cx); s.level = "pr"; }
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  mouseUp(cx) {
    this.bar = null;
    if (!this.dragging) return;
    this.dragging = false;
    if (this.cur?.sel && this.cur.entry !== "local") this.composer.focus();
    cx.notify();
  }

  barMove(e, cx) {
    const s = this.cur, b = this.bar;
    if (!b || s?.entry !== b.entry) return;
    s.scroll[s.entry] = b.scroll + ((e.position.y - b.y) / this.zoom) * b.k;
    cx.notify();
  }

  // ---- render ----

  render(cx) {
    if (this.shown()) {
      // Shown again after a while: re-resolve the target and poll it once.
      if (this.stale) { this.stale = false; this.wantKey = null; this.repoll = true; }
      this.syncTarget(cx);
    } else this.stale = true;
    const t = theme();
    const s = this.cur;
    const ready = Boolean(s?.info);
    this.zoom = settings().zoom ?? 1;
    this.narrow = this.panel && (this.width ?? NARROW) < NARROW;
    const view = this.narrow && ready ? (s.entry == null ? "list" : s.level ?? "list") : null;
    // The body first: the diff names the header's current file.
    const body = !ready ? this.empty(t, s)
      : view === "list" ? this.rail(t, s, true)
      : view === "pr" ? this.detail(t, s)
      : view === "diff" ? this.main(t, s, true)
      : [this.rail(t, s), this.main(t, s)];
    return v_flex().id("pr-review").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .when(this.panel, (el) => el.rounded(10).overflow_hidden().border_1().border_color(t.border)
        .on_size_change((size, cx) => { const w = size.width / this.zoom; if (Math.abs(w - (this.width ?? 0)) > 0.5) { this.width = w; cx.notify(); } }))
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_up("left", (_e, cx) => this.mouseUp(cx))
      .on_mouse_move((e, cx) => this.barMove(e, cx))
      .child(this.header(t, s, view))
      // The window drags by any press nobody stops: only the header bar drags it.
      .child(h_flex().flex_1().min_h(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).children([body].flat()));
  }

  header(t, s, view) {
    const btn = (id, name, tip, onClick, spin) => h_flex().id(id).size(28).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { onClick(cx); cx.notify(); })
      .child(spin ? icon("spinner").size(14).spin(900) : icon(name).size(15));
    const busy = Boolean(s?.loading || s?.prsLoading || s?.diffs?.get(s.entry)?.loading);
    const where = (el) => el
      .when(Boolean(s?.branch), (el) => el.child(div().min_w(0).truncate().font_family(MONO).text_size(12).text_color(t.muted).child(s.branch)))
      .when(Boolean(s?.id?.machine), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`on ${s.id.machine}`)));
    const refresh = btn("pr-refresh", "refresh", "Refresh", (cx) => this.refresh(cx), busy);
    if (this.panel) {
      const back = view === "pr" || view === "diff";
      return h_flex().h(42).flex_none().pl(back ? 8 : 14).pr(8).gap(8).items_center().border_b(1).border_color(t.border)
        .when(back, (el) => el.child(btn("pr-back", "chevron-left", "Back", () => this.back(s)))
          .child(div().min_w(0).truncate().font_semibold().child(view === "diff" ? this.fileTitle ?? "Changes" : this.entryInfo(s).title)))
        .when(!back, (el) => where(el.child(div().flex_none().font_semibold().child(s?.id ? s.name : "Pull requests"))))
        .child(div().flex_1())
        .child(refresh)
        .child(btn("pr-expand", "maximize-2", "Open in window", () => this.expand()));
    }
    return where(h_flex().h(40).flex_none().pl(16).pr(6).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border)
      .child(icon("git-compare").size(15).flex_none().text_color(t.dim))
      .child(div().flex_none().text_size(15).font_semibold().child(s?.id ? s.name : "Pull requests")))
      .child(div().flex_1())
      .child(refresh)
      .child(btn("pr-close", "x", "Close · Esc", () => this.dismiss()));
  }

  quiet(t, text, action) {
    return v_flex().flex_1().min_w(0).h_full().items_center().justify_center().gap(12)
      .child(div().px(16).text_center().text_size(13).text_color(t.muted).child(text))
      .when(Boolean(action), (el) => el.child(action));
  }

  empty(t, s) {
    if (!s) return this.quiet(t, "Focus a terminal in a git repository to see its pull requests.");
    if (s.none || s.loading) return this.quiet(t, s.none ?? "Loading repository…");
    return this.quiet(t, s.error, this.button(t, "pr-retry", "Try again", (cx) => this.refresh(cx)));
  }

  button(t, id, label, onClick, primary, disabled) {
    return h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(6).text_size(12)
      .when(primary, (el) => el.bg(t.accent).text_color(t.accent_foreground).font_medium())
      .when(!primary, (el) => el.border_1().border_color(t.input).hover((x) => x.bg(t.hover)))
      .when(disabled, (el) => el.opacity(0.45))
      .when(!disabled, (el) => el.cursor_pointer().on_click((_e, cx) => { onClick(cx); cx.notify(); }))
      .child(label);
  }

  link(t, id, label, onClick, color) {
    return div().id(id).text_size(12).text_color(color ?? t.muted).cursor_pointer().hover((x) => x.text_color(t.foreground))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
  }

  chip(t, label, color) {
    return h_flex().h(20).px(8).flex_none().items_center().rounded(6).text_size(11).bg(tint(color, "1f")).text_color(color).child(label);
  }

  stateChip(t, p) {
    if (p.isDraft && p.state === "OPEN") return this.chip(t, "Draft", t.idle);
    return this.chip(t, { OPEN: "Open", MERGED: "Merged", CLOSED: "Closed" }[p.state] ?? p.state, { OPEN: t.working, MERGED: t.done }[p.state] ?? t.idle);
  }

  counts(t, add, del) {
    return h_flex().gap(6).flex_none().font_family(MONO).text_size(11)
      .child(div().text_color(t.done).child(`+${add}`))
      .child(div().text_color(t.blocked).child(`−${del}`));
  }

  // ---- left rail ----

  // full: the whole panel (drill-down list) instead of the 280px rail.
  rail(t, s, full) {
    const prs = s.prs ?? [];
    const row = (i, active, entry, content) => h_flex().id(`rail-${i}`).h(52).flex_none().mx(8).px(12).gap(10).items_center().rounded(8).cursor_pointer()
      .when(active, (el) => el.bg(t.selected)).when(!active && s.cursor === i, (el) => el.bg(t.hover))
      .hover((x) => x.bg(active ? t.selected : t.hover))
      .on_click((_e, cx) => { s.cursor = i; s.level = "pr"; this.open(s, entry, cx); cx.notify(); })
      .child(content);
    const empty = s.prsError ?? (s.prs == null ? "Loading pull requests…" : prs.length ? null
      : s.search.trim() ? `No pull requests match “${s.search.trim()}”.` : `No ${s.state === "all" ? "" : s.state + " "}pull requests.`);
    return v_flex().h_full()
      .when(full, (el) => el.flex_1().min_w(0))
      .when(!full, (el) => el.w(280).flex_none().bg(t.surface).border_r(1).border_color(t.border))
      .child(v_flex().p(12).gap(8).flex_none()
        .child(h_flex().h(32).px(10).gap(8).items_center().rounded(8).bg(t.background).border_1().border_color(this.inSearch ? t.accent : t.input)
          .child(icon("search").size(14).flex_none().text_color(t.dim))
          .child(Input.new(this.search).id("pr-search").flex_1().h_full().text_size(13)))
        .child(h_flex().h(28).p(2).gap(2).rounded(8).bg(t.raised)
          .children(STATES.map(([k, label]) => h_flex().id(`st-${k}`).flex_1().h_full().items_center().justify_center().rounded(6).text_size(12).cursor_pointer()
            .when(s.state === k, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
            .when(s.state !== k, (el) => el.text_color(t.muted).hover((x) => x.text_color(t.foreground)))
            .on_click((_e, cx) => { if (s.state !== k) { s.state = k; this.loadPRs(s, cx); } cx.notify(); })
            .child(label)))))
      .child(v_flex().id("pr-list").flex_1().min_h(0).overflow_y_scrollbar().pb(8)
        .child(row(0, s.entry === "local", "local", h_flex().flex_1().min_w(0).gap(10).items_center()
          .child(icon("git-branch").size(14).flex_none().text_color(t.muted))
          .child(v_flex().flex_1().min_w(0).gap(4)
            .child(div().truncate().child(`This branch vs ${s.info.defaultBranch}`))
            .child(div().truncate().font_family(MONO).text_size(11).text_color(t.dim).child(s.branch)))))
        .child(div().h(1).flex_none().mx(20).my(8).bg(t.border))
        .children(prs.map((p, i) => row(i + 1, s.entry === p.number, p.number, v_flex().flex_1().min_w(0).gap(4)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().child(p.title))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(p.updatedAt))))
          .child(h_flex().gap(8).items_center()
            .child(div().flex_none().font_family(MONO).text_size(11).text_color(t.dim).child(`#${p.number}`))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(p.author?.login ?? ""))
            .child(this.counts(t, p.additions, p.deletions))
            .child(this.stateChip(t, p))))))
        .when(Boolean(empty), (el) => el.child(div().px(20).py(8).text_size(13).text_color(t.muted).child(empty))));
  }

  // ---- main: entry header, files, diff ----

  // The selected entry's diff state, PR, files, title and branch line.
  entryInfo(s) {
    const d = s.diffs.get(s.entry);
    const local = s.entry === "local";
    const pr = local ? null : s.prs?.find((p) => p.number === s.entry) ?? d.pr;
    const base = s.info.defaultBranch;
    return {
      d, local, pr, files: d.files ?? [],
      title: pr?.title ?? (local ? `This branch vs ${base}` : "Pull request"),
      sub: pr ? `${pr.headRefName} → ${base}` : local ? `${s.branch} · since merge-base with ${base} · includes uncommitted` : "",
      quiet: d.loading && !d.files ? "Loading diff…" : d.error ?? (d.files?.length ? null : "No changes."),
    };
  }

  threadsBanner(t, d) {
    return div().px(16).py(8).text_size(12).text_color(t.blocked).border_b(1).border_color(t.border).child(`Comments unavailable: ${d.threadsError}`);
  }

  // bare: the drill-down's diff level, without the entry header and file list.
  main(t, s, bare) {
    if (s.entry == null) return this.quiet(t, "Select a pull request, or this branch, to see its changes.");
    const { d, local, pr, files, title, sub, quiet } = this.entryInfo(s);
    const filesOpen = this.filesOpen ?? (this.width ?? Infinity) >= 1040; // rail + file list + a readable diff
    const head = bare ? null : h_flex().h(56).flex_none().px(16).gap(12).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(h_flex().gap(8).items_center()
          .when(!local, (el) => el.child(div().flex_none().font_family(MONO).text_size(13).text_color(t.dim).child(`#${s.entry}`)))
          .child(div().min_w(0).truncate().text_size(15).font_semibold().child(title))
          .when(Boolean(pr), (el) => el.child(this.stateChip(t, pr))))
        .child(h_flex().gap(8).items_center().text_size(12).text_color(t.muted)
          .child(div().min_w(0).truncate().font_family(MONO).text_size(11).text_color(t.dim).child(sub))
          .when(Boolean(pr), (el) => el.child(div().flex_none().child(`${pr.author?.login ?? ""} · ${ago(pr.updatedAt)}`)))))
      .when(files.length > 0, (el) => el
        .child(this.counts(t, files.reduce((a, f) => a + f.additions, 0), files.reduce((a, f) => a + f.deletions, 0)))
        .child(h_flex().id("files-toggle").h(28).px(8).gap(4).items_center().rounded(6).cursor_pointer().text_size(12).text_color(t.muted)
          .hover((x) => x.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.filesOpen = !filesOpen; cx.notify(); })
          .child(icon(filesOpen ? "chevron-down" : "chevron-right").size(14))
          .child(`${files.length} file${files.length === 1 ? "" : "s"}`)));
    this.fileTitle = null;
    if (quiet) return v_flex().flex_1().min_w(0).h_full().when(!bare, (el) => el.child(head)).child(this.quiet(t, quiet));
    const L = this.layout(s, d);
    const diff = this.diff(t, s, d, L); // clamps the scroll the current file is read from
    this.fileTitle = files[this.currentFile(s, L)].path.split("/").pop();
    return v_flex().flex_1().min_w(0).h_full().when(!bare, (el) => el.child(head))
      .when(Boolean(d.threadsError), (el) => el.child(this.threadsBanner(t, d)))
      .child(h_flex().flex_1().min_h(0)
        .when(!bare && filesOpen, (el) => el.child(this.fileList(t, s, d, L)))
        .child(diff));
  }

  // Drill-down level 2: the entry's title and meta, then its files; a file opens the diff there.
  detail(t, s) {
    const { d, local, pr, files, title, sub, quiet } = this.entryInfo(s);
    const L = quiet ? null : this.layout(s, d);
    return v_flex().flex_1().min_w(0).h_full()
      .child(v_flex().flex_none().px(16).py(12).gap(8).border_b(1).border_color(t.border)
        .child(div().text_size(15).font_semibold().child(title))
        .child(h_flex().flex_wrap().gap(8).items_center()
          .when(Boolean(pr), (el) => el.child(this.stateChip(t, pr)))
          .when(!local, (el) => el.child(div().flex_none().font_family(MONO).text_size(12).text_color(t.dim).child(`#${s.entry}`)))
          .when(Boolean(pr), (el) => el.child(div().flex_none().text_size(12).text_color(t.muted).child(`${pr.author?.login ?? ""} · ${ago(pr.updatedAt)}`)))
          .when(files.length > 0, (el) => el.child(this.counts(t, files.reduce((a, f) => a + f.additions, 0), files.reduce((a, f) => a + f.deletions, 0)))))
        .child(div().font_family(MONO).text_size(11).text_color(t.dim).child(sub)))
      .when(Boolean(d.threadsError), (el) => el.child(this.threadsBanner(t, d)))
      .when(Boolean(quiet), (el) => el.child(this.quiet(t, quiet)))
      .when(!quiet, (el) => el.child(v_flex().id("detail-files").flex_1().min_h(0).overflow_y_scrollbar().py(8)
        .child(div().px(16).pb(4).text_size(11).text_color(t.dim).child(`${files.length} file${files.length === 1 ? "" : "s"} changed`))
        .children(files.map((f, fi) => {
          const parts = f.path.split("/"), name = parts.pop();
          const n = (d.threads ?? []).filter((x) => x.path === f.path).length;
          return h_flex().id(`dfile-${fi}`).h(36).flex_none().mx(8).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((x) => x.bg(t.hover))
            .on_click((_e, cx) => { s.scroll[s.entry] = L.fileTops[fi]; s.level = "diff"; cx.notify(); })
            .child(h_flex().flex_1().min_w(0)
              .child(div().min_w(0).truncate().text_color(t.dim).child(parts.length ? parts.join("/") + "/" : ""))
              .child(div().flex_none().max_w(260).truncate().when(f.status === "deleted", (el) => el.text_color(t.muted)).child(name)))
            .when(n > 0, (el) => el.child(h_flex().gap(4).items_center().flex_none().text_size(11).text_color(t.muted).child(icon("message").size(12)).child(String(n))))
            .when(f.additions + f.deletions > 0, (el) => el.child(this.counts(t, f.additions, f.deletions)))
            .child(icon("chevron-right").size(14).flex_none().text_color(t.dim));
        }))));
  }

  // The file whose header is at or above the top of the diff.
  currentFile(s, L) {
    const y = (s.scroll[s.entry] ?? 0) + 1;
    return Math.max(0, L.fileTops.findLastIndex((top) => top <= y));
  }

  fileList(t, s, d, L) {
    const current = this.currentFile(s, L);
    return v_flex().id("files").w(240).flex_none().h_full().py(8).border_r(1).border_color(t.border).overflow_y_scrollbar()
      .children(d.files.map((f, fi) => {
        const n = (d.threads ?? []).filter((x) => x.path === f.path).length;
        return h_flex().id(`file-${fi}`).h(32).flex_none().mx(8).px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(fi === current, (el) => el.bg(t.selected)).hover((x) => x.bg(fi === current ? t.selected : t.hover))
          .tooltip(f.path)
          .on_click((_e, cx) => { s.scroll[s.entry] = L.fileTops[fi]; cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().when(f.status === "deleted", (el) => el.text_color(t.muted)).child(f.path.split("/").pop()))
          .when(n > 0, (el) => el.child(h_flex().gap(4).items_center().flex_none().text_size(11).text_color(t.muted).child(icon("message").size(12)).child(String(n))))
          .when(f.additions + f.deletions > 0, (el) => el.child(this.counts(t, f.additions, f.deletions)));
      }));
  }

  // Every diff item with its height: file headers, rows, notes, thread cards, the composer.
  layout(s, d) {
    const items = [], tops = [], fileTops = [];
    let y = 0;
    const push = (it) => { items.push(it); tops.push(y); y += it.h; };
    const card = (th) => {
      const open = !th.isResolved || this.expanded.has(th.id);
      const measure = `th-${th.id}-${open}`;
      push({ k: "thread", key: `th-${th.id}`, th, measure, h: this.heights.get(measure) ?? (open ? H.thread : H.resolved) });
    };
    d.files.forEach((f, fi) => {
      if (fi) push({ k: "gap", key: `gap-${fi}`, h: H.gap });
      fileTops.push(y);
      push({ k: "file", key: `file-${fi}`, f, h: H.file });
      const { at, loose } = anchorThreads(f.rows, (d.threads ?? []).filter((x) => x.path === f.path));
      const note = f.binary ? "Binary file not shown." : f.rows.length ? null
        : { deleted: "Empty file deleted.", renamed: "Renamed without changes.", added: "Empty file added." }[f.status] ?? "No text changes.";
      if (note) push({ k: "note", key: `note-${fi}`, text: note, h: H.note });
      loose.forEach(card);
      const range = s.sel?.fi === fi ? selectRange(f.rows, s.sel.anchor, s.sel.focus) : null;
      f.rows.forEach((row, ri) => {
        push({ k: "row", key: `r-${fi}-${ri}`, fi, ri, row, on: Boolean(range) && ri >= range.from && ri <= range.to, h: row.kind === "hunk" ? H.hunk : H.row });
        (at.get(ri) ?? []).forEach(card);
        if (range?.to !== ri) return;
        if (s.entry === "local") push({ k: "note", key: "local-note", text: "This branch is read-only here: comments need a pull request.", h: H.note });
        else push({ k: "composer", key: "composer", range, measure: "composer", h: this.heights.get("composer") ?? H.composer });
      });
    });
    return { items, tops, heights: items.map((x) => x.h), total: y + 24, fileTops };
  }

  diff(t, s, d, L) {
    const view = this.diffH ?? 600;
    const max = Math.max(0, L.total - view);
    const scroll = (s.scroll[s.entry] = Math.max(0, Math.min(s.scroll[s.entry] ?? 0, max)));
    const shown = [];
    for (let i = firstVisible(L.tops, L.heights, scroll); i < L.items.length && L.tops[i] < scroll + view; i++) shown.push(i);
    const thumbH = Math.max(32, (view * view) / Math.max(L.total, 1));
    // Sticky header: the current file's header pins to the top until the next file pushes it out.
    const fi = L.fileTops.findLastIndex((y) => y <= scroll);
    const stick = fi >= 0 && scroll > L.fileTops[fi] ? Math.min(0, (L.fileTops[fi + 1] ?? Infinity) - H.gap - H.file - scroll) : null;
    return div().id("diff").relative().flex_1().min_w(0).h_full().overflow_hidden()
      .on_size_change((size, cx) => { const h = size.height / this.zoom; if (Math.abs(h - (this.diffH ?? 0)) > 0.5) { this.diffH = h; cx.notify(); } })
      .on_scroll_wheel((e, cx) => { s.scroll[s.entry] = Math.max(0, Math.min((s.scroll[s.entry] ?? 0) - e.delta.y, max)); cx.notify(); })
      .children(shown.map((i) => this.item(t, s, d, L.items[i]).absolute().left(0).right(0).top(L.tops[i] - scroll)))
      .when(stick != null, (el) => el.child(this.item(t, s, d, { k: "file", f: d.files[fi], h: H.file }).absolute().left(0).right(0).top(stick)))
      .when(max > 0, (el) => el.child(div().id("diff-bar").absolute().right(2).w(6).top((scroll / max) * (view - thumbH)).h(thumbH).rounded(3)
        .bg(tint(t.foreground, this.bar ? "55" : "26")).hover((x) => x.bg(tint(t.foreground, "40")))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.bar = { y: e.position.y, scroll, k: max / (view - thumbH), entry: s.entry }; cx.notify(); })));
  }

  // Cards size to their content: measured once drawn, laid out by that from then on.
  measured(it, el) {
    return div().id(it.key).pl(this.narrow ? 12 : GUTTER).pr(this.narrow ? 12 : 24).py(6).child(el)
      .on_size_change((size, cx) => {
        const h = size.height / this.zoom;
        if (Math.abs(h - (this.heights.get(it.measure) ?? 0)) > 0.5) { this.heights.set(it.measure, h); cx.notify(); }
      });
  }

  item(t, s, d, it) {
    if (it.k === "row") return this.row(t, s, it);
    if (it.k === "gap") return div().h(it.h);
    if (it.k === "note") return h_flex().h(it.h).pl(this.narrow ? 16 : GUTTER).pr(16).items_center().text_size(12).text_color(t.muted).child(div().min_w(0).truncate().child(it.text));
    if (it.k === "thread") return this.measured(it, this.thread(t, s, it.th));
    if (it.k === "composer") return this.measured(it, this.composerCard(t, s, d, it.range));
    const f = it.f;
    const label = { added: "Added", deleted: "Deleted", renamed: "Renamed" }[f.status];
    return h_flex().h(it.h).pl(16).pr(20).gap(8).items_center().bg(t.surface).border_t(1).border_b(1).border_color(t.border)
      .child(div().min_w(0).truncate().font_family(MONO).text_size(12).font_medium().child(f.path))
      .when(f.status === "renamed", (el) => el.child(div().min_w(0).truncate().font_family(MONO).text_size(11).text_color(t.dim).child(`from ${f.oldPath}`)))
      .child(div().flex_1())
      .when(Boolean(label), (el) => el.child(this.chip(t, label, { deleted: t.blocked, added: t.done }[f.status] ?? t.idle)))
      .when(f.additions + f.deletions > 0, (el) => el.child(this.counts(t, f.additions, f.deletions)));
  }

  row(t, s, it) {
    const r = it.row;
    if (r.kind === "hunk") return h_flex().h(it.h).pl(GUTTER).pr(16).items_center().bg(t.surface).font_family(MONO).text_size(11).text_color(t.dim)
      .child(div().min_w(0).truncate().child(r.text));
    const add = r.kind === "add", del = r.kind === "del";
    const num = (n) => div().w(44).flex_none().pr(8).text_right().text_size(11).text_color(it.on ? t.accent : t.dim).child(n == null ? "" : String(n));
    return h_flex().id(it.key).h(it.h).items_center().font_family(MONO).text_size(12).cursor_pointer()
      .when(add, (el) => el.bg(tint(t.done, "1a"))).when(del, (el) => el.bg(tint(t.blocked, "1a")))
      .when(it.on, (el) => el.bg(t.selected))
      .hover((x) => x.bg(it.on ? t.selected : t.hover))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        if (e.modifiers.shift && s.sel?.fi === it.fi) s.sel.focus = it.ri;
        else s.sel = { fi: it.fi, anchor: it.ri, focus: it.ri };
        this.dragging = true;
        cx.notify();
      })
      .on_mouse_move((_e, cx) => {
        if (!this.dragging || s.sel?.fi !== it.fi || s.sel.focus === it.ri) return;
        s.sel.focus = it.ri;
        cx.notify();
      })
      .child(div().w(2).h_full().flex_none().when(it.on, (el) => el.bg(t.accent)))
      .child(num(r.old)).child(num(r.new))
      .child(div().w(14).flex_none().text_color(add ? t.done : del ? t.blocked : t.dim).child(add ? "+" : del ? "−" : ""))
      .child(div().flex_1().min_w(0).pr(16).whitespace_nowrap().overflow_hidden().child(r.text.replace(/\t/g, "    ")));
  }

  composerCard(t, s, d, r) {
    const where = `${r.side === "LEFT" ? "old " : ""}line${r.start === r.end ? ` ${r.end}` : `s ${r.start}–${r.end}`}`;
    return v_flex().p(12).gap(8).rounded(10).bg(t.surface).border_1().border_color(t.accent)
      .child(h_flex().gap(8).items_center()
        .child(icon("message").size(13).text_color(t.accent))
        .child(div().flex_none().text_size(12).text_color(t.muted).child(`Comment on ${where}`))
        .child(div().flex_1())
        .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child("⌘↵ post · Esc cancel")))
      .child(div().rounded(6).bg(t.background).border_1().border_color(t.input).px(8).py(6).child(Textarea.new(this.composer).id("composer").h(64).w_full().text_size(13)))
      .when(Boolean(this.composeError), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.composeError)))
      .child(h_flex().gap(8).items_center().justify_end()
        .child(this.button(t, "compose-cancel", "Cancel", () => { s.sel = null; this.composeError = null; this.typing = false; }))
        .child(this.button(t, "compose-post", this.posting ? "Posting…" : "Comment", (cx) => this.post(cx), true, this.posting || !d.headOid)));
  }

  thread(t, s, th) {
    const busy = this.busy === th.id;
    const err = this.actError?.thread === th.id ? this.actError.msg : null;
    const first = th.comments[0];
    const toggle = h_flex().id(`thr-${th.id}`).cursor_pointer().on_click((_e, cx) => {
      this.expanded.has(th.id) ? this.expanded.delete(th.id) : this.expanded.add(th.id);
      cx.notify();
    });
    const card = v_flex().rounded(10).bg(t.surface).border_1().border_color(t.border).overflow_hidden();
    if (th.isResolved && !this.expanded.has(th.id)) return card.child(toggle.h(30).px(12).gap(8).items_center().hover((x) => x.bg(t.hover))
      .child(icon("chevron-right").size(13).flex_none().text_color(t.dim))
      .child(this.chip(t, "Resolved", t.done))
      .child(div().flex_none().text_size(12).font_semibold().child(first?.author?.login ?? ""))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child((first?.body ?? "").split("\n")[0]))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(`${th.comments.length} comment${th.comments.length === 1 ? "" : "s"}`)));
    const lines = th.line == null ? "Outdated" : th.startLine && th.startLine !== th.line ? `Lines ${th.startLine}–${th.line}` : `Line ${th.line}`;
    const dr = this.draft?.thread === th.id ? this.draft : null;
    return card
      .child(h_flex().h(36).px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .when(th.isResolved, (el) => el.child(toggle.child(icon("chevron-down").size(13).text_color(t.dim))))
        .child(div().font_family(MONO).text_size(11).text_color(t.dim).child(`${th.diffSide === "LEFT" ? "old · " : ""}${lines}`))
        .when(th.isOutdated, (el) => el.child(this.chip(t, "Outdated", t.idle)))
        .when(th.isResolved, (el) => el.child(this.chip(t, "Resolved", t.done)))
        .child(div().flex_1())
        .when(busy, (el) => el.child(icon("spinner").size(13).text_color(t.dim).spin(900)))
        .when(!busy, (el) => el.child(this.link(t, `res-${th.id}`, th.isResolved ? "Unresolve" : "Resolve",
          (cx) => this.act(th, () => (th.isResolved ? gh.unresolveThread : gh.resolveThread)(s.id, th.id), cx)))))
      .children(th.comments.map((c, ci) => this.comment(t, s, th, c, ci, dr)))
      .when(Boolean(err), (el) => el.child(div().px(12).pb(10).text_size(12).text_color(t.blocked).child(err)))
      .child(dr?.kind === "reply"
        ? v_flex().p(12).gap(8).border_t(1).border_color(t.border)
          .child(div().rounded(6).bg(t.background).border_1().border_color(t.input).px(8).py(6).child(Textarea.new(dr.state).id(`reply-${th.id}`).h(48).w_full().text_size(13)))
          .child(h_flex().gap(8).justify_end()
            .child(this.button(t, `reply-cancel-${th.id}`, "Cancel", () => this.dropDraft()))
            .child(this.button(t, `reply-send-${th.id}`, busy ? "Sending…" : "Reply", (cx) => this.saveDraft(cx), true, busy)))
        : h_flex().h(36).px(12).items_center().border_t(1).border_color(t.border)
          .child(this.link(t, `reply-${th.id}`, "Reply…", () => this.startDraft("reply", th))));
  }

  comment(t, s, th, c, ci, dr) {
    const editing = dr?.kind === "edit" && dr.comment === c.databaseId;
    const confirming = this.confirm === c.databaseId;
    const idle = !confirming && !editing && this.busy !== th.id;
    return v_flex().px(12).py(10).gap(4).when(ci > 0, (el) => el.border_t(1).border_color(t.border))
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(13).font_semibold().child(c.author?.login ?? "ghost"))
        .child(div().text_size(11).text_color(t.dim).child(ago(c.createdAt)))
        .child(div().flex_1())
        .when(confirming, (el) => el
          .child(div().text_size(12).text_color(t.muted).child("Delete this comment?"))
          .child(this.link(t, `del-yes-${c.databaseId}`, "Delete", (cx) => { this.confirm = null; this.act(th, (nwo) => gh.deleteComment(s.id, nwo, c.databaseId), cx); }, t.blocked))
          .child(this.link(t, `del-no-${c.databaseId}`, "Keep", () => (this.confirm = null))))
        .when(idle && c.viewerCanUpdate, (el) => el.child(this.link(t, `edit-${c.databaseId}`, "Edit", () => this.startDraft("edit", th, c))))
        .when(idle && c.viewerCanDelete, (el) => el.child(this.link(t, `del-${c.databaseId}`, "Delete", () => (this.confirm = c.databaseId)))))
      .child(editing
        ? v_flex().gap(8).pt(4)
          .child(div().rounded(6).bg(t.background).border_1().border_color(t.input).px(8).py(6).child(Textarea.new(dr.state).id(`edit-box-${c.databaseId}`).h(64).w_full().text_size(13)))
          .child(h_flex().gap(8).justify_end()
            .child(this.button(t, `edit-cancel-${c.databaseId}`, "Cancel", () => this.dropDraft()))
            .child(this.button(t, `edit-save-${c.databaseId}`, "Save", (cx) => this.saveDraft(cx), true, this.busy === th.id)))
        : TextView.markdown(`md-${c.id}`, c.body).selectable(true).scrollable(false).w_full().text_size(13).text_color(t.foreground));
  }
}
