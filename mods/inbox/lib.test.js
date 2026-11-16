import { test, expect } from "bun:test";
import { subAgents } from "./lib.js";

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
