import { test, expect } from "bun:test";
import { seed, decide, settle, listKey } from "./keyboard-lib.js";

const base = { id: "excalidraw", panel: true, shown: true, held: false, opened: null, back: null, over: null };
const run = (state, sig, now) => decide(state, { ...base, ...sig }, now);

test("decide: opened for this id, fresh, focuses after 50; other id, stale or seen: nothing", () => {
  const s0 = seed(base);
  const a = run(s0, { opened: { id: "excalidraw", at: 990 } }, 1000);
  expect(a.focus).toEqual({ after: 50, check: "none" });
  expect(run(a.state, { opened: { id: "excalidraw", at: 990 } }, 1100).focus).toBe(null); // seen
  expect(run(s0, { opened: { id: "graph", at: 990 } }, 1000).focus).toBe(null);
  expect(run(s0, { opened: { id: "excalidraw", at: 990 } }, 3991).focus).toBe(null); // 3001 ms old
});

test("decide: back focuses a shown panel after 80; never a sidebar list", () => {
  const s0 = seed(base);
  expect(run(s0, { back: 990 }, 1000).focus).toEqual({ after: 80, check: "none" });
  expect(run(seed({ ...base, panel: false }), { panel: false, back: 990 }, 1000).focus).toBe(null);
});

test("decide: a hidden panel neither acts on nor consumes opened/back", () => {
  const s0 = seed(base);
  const hidden = run(s0, { shown: false, back: 990, opened: { id: "excalidraw", at: 990 } }, 1000);
  expect(hidden.focus).toBe(null);
  expect(run(hidden.state, { back: 990 }, 1200).focus).toEqual({ after: 80, check: "none" }); // shown, still fresh
});

test("decide: a stale signal present at creation is ignored", () => {
  const sig = { ...base, opened: { id: "excalidraw", at: 990 }, back: 995, over: { at: 996, open: false } };
  expect(decide(seed(sig), sig, 1000).focus).toBe(null);
});

test("decide: dialog-return uses the previous frame's held; went or not held: nothing", () => {
  let s = seed(base);
  s = run(s, { held: true }, 1000).state;                                  // frame 1: the keyboard is here
  s = run(s, { held: false, over: { at: 1010, open: true } }, 1010).state; // frame 2: a dialog took it
  const closed = run(s, { over: { at: 1500, open: false } }, 1500);
  expect(closed.focus).toEqual({ after: 80, check: "no-dialog" });          // the wiring re-checks no dialog is open
  expect(closed.state.resume).toBe(true);                                   // cleared by settle(), after the check
  expect(run(s, { over: { at: 1500, open: false, went: true } }, 1500).focus).toBe(null);
  let t = run(seed(base), { held: false }, 1000).state;
  t = run(t, { over: { at: 1010, open: true } }, 1010).state;
  expect(run(t, { over: { at: 1500, open: false } }, 1500).focus).toBe(null); // it wasn't here
});

test("decide: a menu closing straight into a confirm keeps the way back until the confirm closes", () => {
  let s = seed({ ...base, panel: false });
  s = run(s, { panel: false, held: true }, 1000).state;
  s = run(s, { panel: false, over: { at: 1010, open: true } }, 1010).state;  // the menu
  s = run(s, { panel: false, over: { at: 1100, open: false } }, 1100).state; // it closes…
  s = run(s, { panel: false, over: { at: 1120, open: true } }, 1120).state;  // …into a confirm, before the settle
  expect(run(s, { panel: false, over: { at: 1500, open: false } }, 1500).focus).toEqual({ after: 80, check: "no-dialog" });
  expect(settle(s).resume).toBe(false);
});

test("decide: a sidebar list returns after dialogs too", () => {
  let s = seed({ ...base, panel: false, id: "spaces-plus" });
  s = run(s, { panel: false, held: true }, 1000).state;
  s = run(s, { panel: false, held: true, over: { at: 1010, open: true } }, 1010).state;
  expect(run(s, { panel: false, over: { at: 1500, open: false } }, 1500).focus).toEqual({ after: 80, check: "no-dialog" });
});

test("listKey: hjkl move, not while typing; other keys unchanged", () => {
  expect(["j", "k", "h", "l"].map((k) => listKey(k, false))).toEqual(["down", "up", "left", "right"]);
  expect(listKey("j", true)).toBe("j");
  expect(listKey("x", false)).toBe("x");
  expect(listKey("ctrl-j", false)).toBe("ctrl-j");
});
