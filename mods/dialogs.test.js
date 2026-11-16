// Emergence's dialogs share one frame (RECIPE "Dialogs"), but mods can't import each other, so each keeps its own copy.
// This holds the copies together: change one and this fails until the others match.
import { test, expect } from "bun:test";
import * as settings from "./emergence-settings/lib.js";
import * as keys from "./emergence-keys/lib.js";
import * as confirm from "./confirm-safe/lib.js";
import * as sweep from "./worktree-sweep/lib.js";

test("every dialog draws the same frame: padding, gap, title row, corner, button", () => {
  for (const m of [keys, confirm, sweep]) expect(m.DIALOG).toEqual(settings.DIALOG);
});
