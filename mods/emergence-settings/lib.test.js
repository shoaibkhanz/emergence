import { test, expect } from "bun:test";
import { sections, toggles, choose, DIALOG } from "./lib.js";
import { decide, withoutStale } from "../side/lib.js";

const OFFER = { names: { claude: "Claude Code", opencode: "OpenCode", codex: "Codex" }, supported: ["claude", "opencode"] };
const of = (store) => (k) => store[k];
const row = (secs, id) => secs.flatMap((s) => s.rows).find((r) => r.id === id);

test("sidebar, PRs and Library: each switch reads its shared key and writes the flip", () => {
  const off = sections(of({}), null);
  expect(row(off, "sidebar.dots")).toMatchObject({ on: false, writes: [["sidebar.folded", "dots"]] });
  expect(row(off, "prs.split")).toMatchObject({ on: false, writes: [["pr-review.split", true]] });
  expect(row(off, "skills.big")).toMatchObject({ on: false, writes: [["skills.big", true], ["skills.wsize", null]] });
  const on = sections(of({ "sidebar.folded": "dots", "pr-review.split": true, "skills.big": true }), null);
  expect(row(on, "sidebar.dots")).toMatchObject({ on: true, writes: [["sidebar.folded", "rail"]] });
  expect(row(on, "prs.split").writes).toEqual([["pr-review.split", false]]);
  expect(row(on, "skills.big").writes[0]).toEqual(["skills.big", false]);
});

test("side chats: a row per harness the side mod names; only installed, supported ones switch", () => {
  const secs = sections(of({ "side.supported": OFFER, "side.harnesses": { opencode: false } }), { claude: true, opencode: true, codex: true });
  expect(row(secs, "side.claude")).toMatchObject({ name: "Claude Code", on: true });
  expect(row(secs, "side.opencode")).toMatchObject({ on: false });
  expect(row(secs, "side.codex").note).toBe("coming");
  expect(row(secs, "side.codex").writes).toBeUndefined();
  const missing = sections(of({ "side.supported": OFFER }), { claude: false });
  expect(row(missing, "side.claude")).toMatchObject({ on: false, note: "not installed" });
  expect(row(sections(of({ "side.supported": OFFER }), null), "side.claude").note).toBe("checking…");
});

test("side chats: before the side mod has said what it supports, a line instead of rows", () => {
  const side = sections(of({}), {}).find((s) => s.title === "Side chats");
  expect(side.rows).toEqual([]);
  expect(side.empty).toBeTruthy();
});

test("side chats: a flip writes only supported harnesses, and side's decide follows it", () => {
  const store = { "side.supported": OFFER, "side.harnesses": { codex: false } }, known = { claude: true, opencode: true };
  const [[key, value]] = row(sections(of(store), known), "side.claude").writes;
  expect(key).toBe("side.harnesses");
  expect(value).toEqual({ claude: false });
  expect(withoutStale(value, OFFER.supported)).toEqual(value);
  expect(decide("claude", value, known, OFFER.supported).action).toBe("notice");
  expect(decide("opencode", value, known, OFFER.supported).action).toBe("open"); // never switched: on, no chooser
  const back = row(sections(of({ ...store, "side.harnesses": value }), known), "side.claude").writes[0][1];
  expect(decide("claude", back, known, OFFER.supported).action).toBe("open");
});

test("toggles: the rows the keyboard walks, in drawn order", () => {
  const secs = sections(of({ "side.supported": OFFER }), { claude: true, opencode: true });
  expect(toggles(secs).map((r) => r.id)).toEqual(["sidebar.dots", "prs.split", "skills.big", "side.claude", "side.opencode"]);
});

test("sub-agent history: shown only once the Agents graph offers it; 1 day, 3 days or 1 week, a week unless chosen", () => {
  expect(row(sections(of({}), null), "agents.history")).toBeUndefined();
  const r = row(sections(of({ "agent-graph.historyOffered": true }), null), "agents.history");
  expect(r).toMatchObject({ kind: "choice", value: 7 });
  expect(r.options.map((o) => o.label)).toEqual(["1 day", "3 days", "1 week"]);
  expect(r.options[1].writes).toEqual([["agent-graph.history", 3]]);
  expect(r.value).toBe(7);
  expect(row(sections(of({ "agent-graph.historyOffered": true, "agent-graph.history": 7 }), null), "agents.history").value).toBe(7);
  expect(row(sections(of({ "agent-graph.historyOffered": true, "agent-graph.history": 30 }), null), "agents.history").value).toBe(7); // the old 30 days: a week now
  expect(toggles(sections(of({ "agent-graph.historyOffered": true }), null)).map((x) => x.id)).toContain("agents.history");
});

test("background: under Agents with history; seven styles, sparse dots unless chosen, the same names agent-graph draws", async () => {
  expect(row(sections(of({}), null), "agents.pattern")).toBeUndefined();
  const r = row(sections(of({ "agent-graph.historyOffered": true }), null), "agents.pattern");
  expect(r).toMatchObject({ kind: "choice", value: "sparse", name: "Background" });
  expect(r.options.map((o) => o.label)).toEqual(["None", "Sparse dots", "Gravity", "Fading dots", "Isometric dots", "Graph paper", "Topographic"]);
  expect(r.options[2].writes).toEqual([["agent-graph.pattern", "gravity"]]);
  expect(row(sections(of({ "agent-graph.historyOffered": true, "agent-graph.pattern": "dots" }), null), "agents.pattern").value).toBe("sparse");
  expect(row(sections(of({ "agent-graph.historyOffered": true }), null), "agents.dots").name).toBe("Background strength");
  const { PATTERNS } = await import("../agent-graph/lib.js");
  expect(r.options.map((o) => o.value)).toEqual(Object.keys(PATTERNS));
});

test("grain: under Agents, Off to 25% in steps of 5, 10% unless chosen, the same default agent-graph draws", async () => {
  const r = row(sections(of({ "agent-graph.historyOffered": true }), null), "agents.grain");
  expect(r).toMatchObject({ kind: "choice", value: 10, name: "Grain" });
  expect(r.options.map((o) => o.label)).toEqual(["Off", "5%", "10%", "15%", "20%", "25%"]);
  expect(r.options[0].writes).toEqual([["agent-graph.filmGrain", 0]]);
  expect(row(sections(of({ "agent-graph.historyOffered": true, "agent-graph.filmGrain": 30 }), null), "agents.grain").value).toBe(10);
  const { grainOpacity } = await import("../agent-graph/lib.js");
  expect(grainOpacity(undefined)).toBe(0.1);
  expect(grainOpacity(0)).toBe(0);
  expect(grainOpacity(25)).toBe(0.25);
  expect(grainOpacity(30)).toBe(0.1);
});

test("dots: under Agents with history; Off to 25% in steps of 5, 25% unless chosen", () => {
  expect(row(sections(of({}), null), "agents.dots")).toBeUndefined();
  const r = row(sections(of({ "agent-graph.historyOffered": true }), null), "agents.dots");
  expect(r).toMatchObject({ kind: "choice", value: 25 });
  expect(r.options.map((o) => o.label)).toEqual(["Off", "5%", "10%", "15%", "20%", "25%"]);
  expect(r.options[5].writes).toEqual([["agent-graph.dots", 25]]);
  expect(row(sections(of({ "agent-graph.historyOffered": true, "agent-graph.dots": 0 }), null), "agents.dots").value).toBe(0);
  expect(row(sections(of({ "agent-graph.historyOffered": true, "agent-graph.dots": 40 }), null), "agents.dots").value).toBe(25); // past the cap
  expect(choose({ ...r, value: 25 }, 1)).toEqual([]);
});

test("choose: ←/→ step a choice, stopping at its ends; ↵ (0) goes round; a switch just flips", () => {
  const r = row(sections(of({ "agent-graph.historyOffered": true, "agent-graph.history": 7 }), null), "agents.history");
  expect(choose(r, -1)).toEqual([["agent-graph.history", 3]]);
  expect(choose(r, 1)).toEqual([]); // a week is the last
  expect(choose(r, 0)).toEqual([["agent-graph.history", 1]]); // ↵ goes round
  const sw = row(sections(of({}), null), "prs.split");
  expect(choose(sw, 0)).toEqual(sw.writes);
});

test("the dialog frame: RECIPE's numbers", () => {
  expect(DIALOG).toEqual({ pad: 24, gap: 16, title: 22, radius: 10, button: 32 });
});

test("sidebar sizes: on while a section has a dragged size, flipping clears them; none dragged is a note", () => {
  expect(row(sections(of({ "sidebar.sized": { spaces: 300 } }), null), "sidebar.sized"))
    .toMatchObject({ on: true, writes: [["sidebar.sized", null]] });
  for (const sized of [undefined, null, {}]) {
    const r = row(sections(of({ "sidebar.sized": sized }), null), "sidebar.sized");
    expect(r).toMatchObject({ on: false, note: "none: drag a line to set one" });
    expect(r.writes).toBeUndefined();
  }
});
