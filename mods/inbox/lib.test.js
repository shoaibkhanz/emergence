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
  expect(splitColumn({ H: 800, spacesWant: 100, need: 150, portsMin: 94, collapsed: false })).toEqual({ spaces: 100, ports: 550 });
  // A long inbox: Ports keeps only what it needs; the inbox scrolls in the rest.
  expect(splitColumn({ H: 800, spacesWant: 100, need: 900, portsMin: 94, collapsed: false })).toEqual({ spaces: 100, ports: 94 });
  // A near-empty inbox still keeps its 90px.
  expect(splitColumn({ H: 800, spacesWant: 100, need: 41, portsMin: 94, collapsed: false })).toEqual({ spaces: 100, ports: 610 });
  // Folded: no Ports.
  expect(splitColumn({ H: 800, spacesWant: 100, need: 40, portsMin: 0, collapsed: true }).ports).toBe(0);
  // Before the first measure: Spaces at most 285, Ports what it needs.
  expect(splitColumn({ H: 0, spacesWant: 400, need: 150, portsMin: 94, collapsed: false })).toEqual({ spaces: 285, ports: 94 });
  // Spaces still gives way to the inbox (never under half of what the two share) once Ports has its share.
  expect(splitColumn({ H: 600, spacesWant: 500, need: 300, portsMin: 100, collapsed: false })).toEqual({ spaces: 250, ports: 100 });
});
