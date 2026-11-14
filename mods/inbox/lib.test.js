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
