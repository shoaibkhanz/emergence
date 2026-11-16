import { test, expect } from "bun:test";
import { sections, toggles } from "./lib.js";
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
  expect(row(sections(of({ "side.supported": OFFER }), null), "side.claude").note).toBe("…");
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
