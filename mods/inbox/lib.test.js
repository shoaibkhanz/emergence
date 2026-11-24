import { test, expect } from "bun:test";
import { subAgents, columnHeight } from "./lib.js";

test("subAgents: live agent sub-terminals agents() misses, blocked from error too; not tab agents, shells or the dead", () => {
  const terms = [
    { address: "t1", state: "live", parent: null, status: "working", program: { agent: true } },                 // a tab agent (known)
    { address: "t2", state: "live", parent: "t1", status: "blocked", title: "Wrap module", program: { agent: true, name: "Claude Code" }, cwd: "/w/orch-demo-wrap" },
    { address: "t3", state: "live", parent: "t1", status: "error", program: { agent: true }, cwd: "/w/x" },
    { address: "t4", state: "live", parent: "t1", status: "working", program: { agent: false } },                // a shell
    { address: "t5", state: "finished", parent: "t1", status: "blocked", program: { agent: true } },             // gone
    { address: "t6", state: "live", parent: "t1", status: "working", program: { agent: true }, cwd: "/w/y" },    // working: counted, no card
    { address: "t7", state: "live", parent: "t1", status: "blocked", program: { agent: false }, report: { state: "blocked" }, cwd: "/w/z" }, // reports a status: an agent, as the graph counts
  ];
  const subs = subAgents(terms, new Set(["t1"]));
  expect(subs.map((s) => [s.address, s.status])).toEqual([["t2", "blocked"], ["t3", "blocked"], ["t6", "working"], ["t7", "blocked"]]);
  expect(subs[0]).toMatchObject({ sub: true, title: "Wrap module", space_name: "orch-demo-wrap", program: { name: "Claude Code" } });
});

import { splitColumn } from "./lib.js";

test("splitColumn: Spaces as before; the inbox gets its cards (at least 90px); Ports gets the rest, at least what it needs", () => {
  // 800px column, Spaces wants 100, the inbox's cards need 150, Ports needs 94: Ports takes the slack under the cards.
  expect(splitColumn({ H: 800, spacesWant: 100, need: 150, portsMin: 94, collapsed: false })).toEqual({ spaces: 100, side: 0, ports: 550 });
  // A long inbox: Ports keeps only what it needs; the inbox scrolls in the rest.
  expect(splitColumn({ H: 800, spacesWant: 100, need: 900, portsMin: 94, collapsed: false })).toEqual({ spaces: 100, side: 0, ports: 94 });
  // A near-empty inbox still keeps its 90px.
  expect(splitColumn({ H: 800, spacesWant: 100, need: 41, portsMin: 94, collapsed: false })).toEqual({ spaces: 100, side: 0, ports: 610 });
  // Folded: no Ports.
  expect(splitColumn({ H: 800, spacesWant: 100, need: 40, portsMin: 0, collapsed: true }).ports).toBe(0);
  // Before the first measure: Spaces at most 285, Ports what it needs.
  expect(splitColumn({ H: 0, spacesWant: 400, need: 150, portsMin: 94, collapsed: false })).toEqual({ spaces: 285, side: 0, ports: 94 });
  // Spaces still gives way to the inbox (never under half of what the two share) once Ports has its share.
  expect(splitColumn({ H: 600, spacesWant: 500, need: 300, portsMin: 100, collapsed: false })).toEqual({ spaces: 250, side: 0, ports: 100 });
});

test("splitColumn: Side chats takes its height first; a long inbox never squeezes it; a short column floors it", () => {
  expect(splitColumn({ H: 800, spacesWant: 100, need: 150, portsMin: 94, sideWant: 101, collapsed: false }))
    .toEqual({ spaces: 100, side: 101, ports: 449 });
  expect(splitColumn({ H: 800, spacesWant: 100, need: 900, portsMin: 94, sideWant: 101, collapsed: false }))
    .toEqual({ spaces: 100, side: 101, ports: 94 }); // long inbox: Side chats keeps 101
  expect(splitColumn({ H: 350, spacesWant: 100, need: 150, portsMin: 94, sideWant: 161, collapsed: false }))
    .toEqual({ spaces: 60, side: 106, ports: 94 }); // short column: Side chats shrinks, the inbox keeps its 90
  expect(splitColumn({ H: 300, spacesWant: 100, need: 150, portsMin: 94, sideWant: 161, collapsed: false }))
    .toEqual({ spaces: 60, side: 56, ports: 94 }); // shorter: less than a row, the list scrolls; never over the inbox
  expect(splitColumn({ H: 800, spacesWant: 100, need: 40, portsMin: 0, sideWant: 101, collapsed: true }))
    .toEqual(expect.objectContaining({ side: 0, ports: 0 }));
  expect(splitColumn({ H: 0, spacesWant: 400, need: 150, portsMin: 94, sideWant: 101, collapsed: false }))
    .toEqual({ spaces: 285, side: 101, ports: 94 }); // before the first measure
});

test("splitColumn: a side chat never over-fills a column that fitted without it", () => {
  for (const portsMin of [94, 223]) for (let H = 150 + portsMin; H <= 700; H += 7) {
    const { spaces, side, ports } = splitColumn({ H, spacesWant: 100, need: 150, portsMin, sideWant: 161, collapsed: false });
    expect(spaces + side + ports + 90).toBeLessThanOrEqual(H); // the inbox keeps at least its 90
  }
});

import { inboxHeight } from "./lib.js";

test("inboxHeight: header, the cards (or All caught up), room under them, then Settled and its open shelf", () => {
  expect(inboxHeight({ cards: 0, cardH: 50, settled: 0, shelf: false })).toBe(41 + 32 + 14);
  expect(inboxHeight({ cards: 2, cardH: 50, settled: 0, shelf: false })).toBe(41 + (50 + 2 + 50) + 14);
  expect(inboxHeight({ cards: 1, cardH: null, settled: 0, shelf: false })).toBe(41 + 50 + 14); // before a card is measured
  expect(inboxHeight({ cards: 1, cardH: 50, settled: 3, shelf: false })).toBe(41 + 50 + 14 + 32);
  expect(inboxHeight({ cards: 1, cardH: 50, settled: 3, shelf: true })).toBe(41 + 50 + 14 + 32 + 3 * 30 + 6);
  expect(inboxHeight({ cards: 1, cardH: 50, settled: 10, shelf: true })).toBe(41 + 50 + 14 + 32 + 160 + 6); // the shelf scrolls past 160
});

test("columnHeight: the column only once every section has drawn the size it was given", () => {
  expect(columnHeight(null, [{ px: 200, shown: 200 }])).toBe(0); // before the inbox's first measure
  expect(columnHeight(300, [{ px: 200, shown: 200 }, { px: 70, shown: 70 }])).toBe(570);
  expect(columnHeight(300, [{ px: 200, shown: 201 }])).toBe(501); // a pixel of rounding (zoom) is drawn
  expect(columnHeight(300, [{ px: 200 }])).toBe(500); // not shared yet: as given
  expect(columnHeight(90, [{ px: 200, shown: 200 }, { px: 437, shown: 70 }])).toBe(null); // Ports' growth not drawn yet
  expect(columnHeight(90, [{ px: 400, shown: 300 }, { px: 70, shown: 70 }], true)).toBe(460); // the same mismatch a while on: drawn is the truth
  expect(columnHeight(300, [{ px: 0, shown: 70 }])).toBe(300); // given nothing (folded): nothing, whatever it last shared
});

// The sidebar flickered on another computer: Ports, handed an empty inbox's slack, grew 367px; the inbox shrank in the
// same layout pass but Ports shared its new height a pass later, so the column counted 367px short, every section
// shrank, then grew back, forever. Herdr's layout here: the inbox takes the rest, the others report a pass late.
test("the column settles instead of bouncing when the others report their heights a pass late", () => {
  const T = 800, need = inboxHeight({ cards: 0, settled: 0 }), portsMin = 70, sideWant = 73;
  let px = { spaces: 285, side: 0, ports: portsMin }, shown = { ...px };
  const sizes = [];
  for (let pass = 0; pass < 8; pass++) {
    const ownH = T - px.spaces - px.side - px.ports;
    const H = columnHeight(ownH, ["spaces", "side", "ports"].map((k) => ({ px: px[k], shown: shown[k] })));
    shown = { ...px };
    if (H !== null) px = splitColumn({ H, spacesWant: 200, need, portsMin, sideWant, collapsed: false });
    sizes.push(px.spaces);
  }
  expect(sizes.slice(-4)).toEqual([200, 200, 200, 200]);
  expect(px.spaces + px.side + px.ports + Math.max(need, 90)).toBeLessThanOrEqual(T);
});

// A column too short for what was asked (a smaller window, leaving fullscreen with Ports' old 548px): the inbox stays at
// its layout minimum (90), Herdr draws Ports shorter than asked, and that mismatch never resolves. Waiting for it would
// never refit, leaving Ports over the inbox; the same mismatch on a later pass (main.js: 300ms on) is taken as drawn.
test("a column too short for what was asked refits instead of waiting forever", () => {
  const T = 500, need = inboxHeight({ cards: 0, settled: 0 }), portsMin = 70, sideWant = 32, MIN = 90;
  let px = { spaces: 200, side: 32, ports: 548 }, shown = { ...px }, last = null;
  const layout = (px) => { // fixed sections drawn as asked, the last ones cut to leave the inbox its 90
    let room = T - MIN; const out = {};
    for (const k of ["spaces", "side", "ports"]) { out[k] = Math.max(0, Math.min(px[k], room)); room -= out[k]; }
    return out;
  };
  for (let pass = 0; pass < 8; pass++) {
    const drawnNow = layout(px), ownH = T - drawnNow.spaces - drawnNow.side - drawnNow.ports;
    const blocks = ["spaces", "side", "ports"].map((k) => ({ px: px[k], shown: shown[k] }));
    const sig = JSON.stringify(blocks);
    const H = columnHeight(ownH, blocks, sig === last);
    last = sig;
    shown = drawnNow;
    if (H !== null) px = splitColumn({ H, spacesWant: 200, need, portsMin, sideWant, collapsed: false });
  }
  expect(px.spaces + px.side + px.ports).toBeLessThanOrEqual(T - MIN);
  expect(layout(px)).toEqual(px); // everything drawn as asked: settled
});

test("splitColumn: dragged sizes (sidebar.sized) replace a section's want; the inbox keeps its 90; folded ignores them", () => {
  const base = { H: 800, spacesWant: 100, need: 150, portsMin: 94, collapsed: false };
  expect(splitColumn({ ...base, sized: { spaces: 400 } })).toEqual({ spaces: 400, side: 0, ports: 250 });
  expect(splitColumn({ ...base, sized: { ports: 300 } })).toEqual({ spaces: 100, side: 0, ports: 300 });
  expect(splitColumn({ ...base, sized: { ports: 0 } }).ports).toBe(0);
  expect(splitColumn({ ...base, sideWant: 32, sized: { "side-chats": 200 } }).side).toBe(200);
  const short = splitColumn({ ...base, H: 400, sized: { spaces: 500 } });
  expect(short.spaces).toBe(216);
  expect(short.spaces + short.side + short.ports + 90).toBeLessThanOrEqual(400);
  expect(splitColumn({ ...base, collapsed: true, portsMin: 0, sized: { spaces: 400, ports: 300 } }))
    .toEqual(splitColumn({ ...base, collapsed: true, portsMin: 0 }));
  expect(splitColumn({ ...base, H: 0, sized: { spaces: 150 } }).spaces).toBe(150);
});

import { dragsOf } from "./lib.js";

test("dragsOf: first look adopts; an unapplied send waits; landing where asked is ours; anywhere else is a drag", () => {
  expect(dragsOf({}, { spaces: 120 })).toEqual({ drags: {}, sent: { spaces: { px: 120, from: 120, applied: true } } });
  const waiting = { spaces: { px: 300, from: 100, applied: false } };
  expect(dragsOf(waiting, { spaces: 100 })).toEqual({ drags: {}, sent: waiting });
  expect(dragsOf(waiting, { spaces: 300 })).toEqual({ drags: {}, sent: { spaces: { px: 300, from: 300, applied: true } } });
  // a drag during the wait (splitColumn never asks for more than fits, so Herdr doesn't trim our sends)
  expect(dragsOf(waiting, { spaces: 250 })).toEqual({ drags: { spaces: 250 }, sent: { spaces: { px: 250, from: 250, applied: true } } });
  const settled = { spaces: { px: 250, from: 250, applied: true } };
  expect(dragsOf(settled, { spaces: 251 }).drags).toEqual({}); // zoom's rounding
  expect(dragsOf(settled, { spaces: 320 })).toEqual({ drags: { spaces: 320 }, sent: { spaces: { px: 320, from: 320, applied: true } } });
});

test("dragsOf: the line between Ports and Side chats moves both: both are drags", () => {
  const sent = { ports: { px: 94, from: 94, applied: true }, "side-chats": { px: 71, from: 71, applied: true } };
  expect(dragsOf(sent, { ports: 60, "side-chats": 105 }).drags).toEqual({ ports: 60, "side-chats": 105 });
});
