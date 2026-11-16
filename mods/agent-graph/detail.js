// A sub-agent's details: the dialog a sub-agent card opens (agent-graph's own mod, props { detail, owner, name, sub, panel }), so
// you can see what it did without going to its agent's terminal. subagents.py --detail reads its transcript once,
// for this view only (nothing is cached). Task, then Result (the outcome before the evidence), then Files.
// ↑/↓ pick a section, → shows all of it, ← folds it, ↵ goes to its agent (the one filled button), Esc closes.

import { div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { run, exec, props, closeOverlay, theme, setShared, appHome, home } from "herdr";
import { detailHead, mdLines } from "./lib.js";

const DIALOG = { pad: 24, gap: 16, title: 22, radius: 10, button: 32 }; // Emergence's frame (RECIPE "Dialogs"); join mods/dialogs.test.js when this branch merges
const FOLD = { task: 6, result: 14 }; // lines shown before → shows the rest
const MAX_FILES = 12;
const MONO = "Geist Mono"; // code blocks only (the font rule)

export class Detail {
  constructor(cx) {
    setShared("emergence.over", { at: Date.now(), open: true }); // the keyboard goes back where it was when this closes
    const p = props() ?? {};
    this.d = p.sub ? { ...p.sub, title: p.name } : null; // the card's facts while the transcript loads
    this.err = null;
    this.loading = true;
    this.open = new Set(); // sections shown whole
    this.sel = 0;
    this.scroll = ScrollHandle.new();
    this.h = cx.focus_handle();
    this.h.focus();
    cx.timer.after(300, () => this.h.focus());
    cx.spawn(async (cx) => {
      await cx.sleep(16); // host calls made before a copy's first frame never resolve
      const r = await exec("python3", ["-B", `${appHome()}/mods/agent-graph/subagents.py`, "--detail", JSON.stringify(p.detail)], { timeout: 20000 })
        .catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
      let out = null;
      try { out = JSON.parse(r.stdout); } catch { out = { error: { message: (r.stderr || "subagents.py gave no answer").trim().split("\n").pop() } }; }
      if (out?.detail) this.d = out.detail;
      else this.err = out?.error?.message ?? "Couldn't read it.";
      this.loading = false;
      cx.notify();
    });
  }

  async dismissed() { setShared("emergence.over", { at: Date.now(), open: false }); }

  close() { closeOverlay(props().overlay); }

  // From the side panel, the panel comes along to the agent's space (tabs-plus: shared "panel.carry"), as focusAgent.
  goToAgent() {
    if (props().panel) setShared("panel.carry", { id: "graph", at: Date.now() });
    run("agent.focus", { terminal: props().owner });
    this.close();
  }

  sections() {
    const d = this.d ?? {};
    return ["task", "result", ...(d.edited?.length ? ["files"] : [])];
  }

  key(e, cx) {
    const secs = this.sections(), at = secs[this.sel];
    if (e.key === "escape") this.close();
    else if (e.key === "enter") this.goToAgent();
    else if (e.key === "down" || e.key === "up") this.sel = Math.max(0, Math.min(secs.length - 1, this.sel + (e.key === "down" ? 1 : -1)));
    else if (e.key === "right") this.open = new Set([...this.open, at]);
    else if (e.key === "left") this.open = new Set([...this.open].filter((s) => s !== at));
    else return;
    this.scroll.scroll_to_item(this.sel);
    cx.stop_propagation();
    cx.notify();
  }

  // Text as lines (a transcript's newlines kept), folded to `fold` lines until opened.
  text(t, id, body, fold, empty) {
    if (!body) return div().text_color(t.dim).child(empty);
    const lines = mdLines(body), whole = this.open.has(id), shown = whole ? lines : lines.slice(0, fold);
    const line = (l) => l.kind === "gap" ? div().h(6)
      : l.kind === "h" ? div().pt(2).font_semibold().text_color(t.foreground).child(l.text)
      : l.kind === "li" ? h_flex().items_start().gap(8).pl(l.depth * 14).child(div().flex_none().text_color(t.dim).child("•")).child(div().flex_1().min_w(0).text_color(t.foreground).child(l.text))
      : l.kind === "code" ? div().px(8).bg(t.background).font_family(MONO).text_size(12).text_color(t.foreground).child(l.text || " ")
      : div().text_color(t.foreground).child(l.text);
    return v_flex().gap(2)
      .children(shown.map(line))
      .when(lines.length > fold, (el) => el.child(div().id(`dt-more-${id}`).pt(4).text_size(12).text_color(t.muted).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.open = whole ? new Set([...this.open].filter((s) => s !== id)) : new Set([...this.open, id]); cx.notify(); })
        .child(whole ? "Show less (←)" : `${lines.length - fold} more lines (→)`)));
  }

  section(t, i, id, title, body) {
    const on = i === this.sel;
    return v_flex().flex_none().gap(6)
      .child(div().text_size(11.5).font_medium().text_color(t.dim).child(title))
      .child(v_flex().id(`dt-${id}`).px(12).py(10).rounded(6).bg(t.surface).border_1().border_color(on ? t.input : t.border)
        .on_click((_e, cx) => { this.sel = i; cx.notify(); }).child(body));
  }

  // Each file: its name, then its folder dimmed (worktree-relative, else ~/…), so a long path never hides the name.
  files(t, d) {
    const list = d.edited ?? [], whole = this.open.has("files"), more = whole ? 0 : list.length - MAX_FILES;
    return v_flex().gap(4)
      .children((whole ? list : list.slice(0, MAX_FILES)).map((e) => {
        const p = e.rel ?? e.path.replace(home(), "~"), cut = p.lastIndexOf("/");
        return h_flex().id(`dt-f-${e.path}`).gap(8).items_center().min_w(0).tooltip(e.path)
          .child(div().size(6).flex_none().rounded(3).when(e.dirty, (el) => el.bg(t.accent)))
          .child(div().flex_none().max_w(320).truncate().text_color(t.foreground).child(p.slice(cut + 1)))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(cut > 0 ? p.slice(0, cut) : ""))
          .when(e.dirty, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("uncommitted")));
      }))
      .when(more > 0, (el) => el.child(div().text_size(12).text_color(t.muted).child(`${more} more (→)`)));
  }

  render() {
    const t = theme(), d = this.d ?? {}, now = Date.now(), head = detailHead(d, now);
    const secs = this.sections();
    this.sel = Math.min(this.sel, secs.length - 1);
    const body = {
      task: () => this.section(t, secs.indexOf("task"), "task", "Task", this.loading ? div().text_color(t.dim).child("Reading its transcript…")
        : this.text(t, "task", d.task, FOLD.task, "No task recorded.")),
      result: () => this.section(t, secs.indexOf("result"), "result", "Result", this.loading ? div().text_color(t.dim).child("…")
        : this.text(t, "result", d.result, FOLD.result, d.running ? "Still working." : "It ended without a report.")),
      files: () => this.section(t, secs.indexOf("files"), "files", `Files  ${d.edited.length}`, this.files(t, d)),
    };
    const button = h_flex().id("dt-go").h(DIALOG.button).px(14).gap(6).items_center().rounded(8).cursor_pointer().border_1().text_size(12).font_medium()
      .bg(t.solid).border_color(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88))
      .on_click(() => this.goToAgent()).child("Go to agent").child(div().text_size(11).opacity(0.7).child("↵"));
    return v_flex().id("ag-detail").track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(DIALOG.pad).gap(DIALOG.gap).rounded(DIALOG.radius).bg(t.popover).text_size(13)
      .child(v_flex().flex_none().gap(4)
        .child(h_flex().h(DIALOG.title).items_center().gap(12)
          .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(d.title ?? "Sub-agent"))
          .child(h_flex().flex_none().gap(6).items_center().text_size(12).text_color(d.running ? t.working : t.muted)
            .child(div().size(6).rounded(3).bg(d.running ? t.working : t.dim)).child(head.state))
          .child(div().id("dt-esc").flex_none().px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
        .when(Boolean(head.facts), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(head.facts)))
        .when(Boolean(head.metrics), (el) => el.child(div().truncate().text_size(12).text_color(t.dim).child(head.metrics))))
      .child(this.err
        ? v_flex().flex_1().min_h(0).gap(6).child(div().text_color(t.muted).child(this.err))
          .child(div().text_size(12).text_color(t.dim).child("History is kept 30 days at most; past that, a sub-agent's details aren't kept."))
        : v_flex().id("dt-body").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).gap(18).children(secs.map((s) => body[s]())))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child("↑/↓ section · → show all · ← fold"))
        .child(button));
  }
}
