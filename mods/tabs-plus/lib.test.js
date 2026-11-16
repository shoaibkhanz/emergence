import { test, expect } from "bun:test";
import { panelOnSwitch, CARRY_MS } from "./lib.js";

const ENABLED = ["files", "changes", "graph", "prs"];

test("panelOnSwitch: a space shows the panel it had, closed if it never had one", () => {
  expect(panelOnSwitch({ stored: "prs", enabled: ENABLED, carry: null, now: 0 })).toBe("prs");
  expect(panelOnSwitch({ stored: undefined, enabled: ENABLED, carry: null, now: 0 })).toBe(null);
  expect(panelOnSwitch({ stored: "usage", enabled: ENABLED, carry: null, now: 0 })).toBe(null); // not in this layout
});

// Clicking an agent in the Agents panel went to its space and the panel shut, as that space never had one open.
test("panelOnSwitch: a jump made from a panel brings that panel along", () => {
  const carry = { id: "graph", at: 1000 };
  expect(panelOnSwitch({ stored: undefined, enabled: ENABLED, carry, now: 1500 })).toBe("graph");
  expect(panelOnSwitch({ stored: "prs", enabled: ENABLED, carry, now: 1500 })).toBe("graph");
  expect(panelOnSwitch({ stored: "prs", enabled: ENABLED, carry, now: 1000 + CARRY_MS + 1 })).toBe("prs"); // an old one doesn't
  expect(panelOnSwitch({ stored: null, enabled: ["files"], carry, now: 1500 })).toBe(null); // a panel this layout lacks
});
