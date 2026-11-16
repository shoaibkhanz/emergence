// The sidebar's sections draw to one rhythm, but mods can't import each other, so each keeps its own copy of the
// sizes. This holds the copies together: change one and this fails until the others match.
import { test, expect } from "bun:test";
import * as spaces from "./spaces-plus/lib.js";
import * as inbox from "./inbox/lib.js";
import * as side from "./side-chats/lib.js";
import * as ports from "./ports/lib.js";

test("the sidebar's sections share a header, a row, an empty line, a foot and the room under a list", () => {
  for (const m of [inbox, side, ports]) {
    expect(m.HEADER_H).toBe(41);
    expect(m.EMPTY_H).toBe(32);
  }
  for (const m of [spaces, inbox, side, ports]) expect(m.ROW_H).toBe(30);
  expect(ports.FOOT_H).toBe(inbox.FOOT_H);
  expect(spaces.LIST_PAD).toBe(inbox.LIST_PAD);
});
