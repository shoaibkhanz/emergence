import { test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";

// A mod's view is one class: `this.x = …` on an instance hides a method x() of the class. spaces-plus kept its drawn
// spaces in this.shown, so on_size_change's this.shown(size) called a Set and threw: Spaces never shared spaces.h.
test("no mod's view assigns a field named like one of its methods", () => {
  const clashes = [];
  for (const mod of readdirSync(new URL(".", import.meta.url))) {
    const file = new URL(`./${mod}/main.js`, import.meta.url);
    if (!existsSync(file)) continue;
    if (existsSync(new URL(`./${mod}/SOURCE.md`, import.meta.url))) continue; // copied from elsewhere (a bundle of many classes, which this per-file check can't tell apart)
    const src = readFileSync(file, "utf8");
    const methods = new Set([...src.matchAll(/^ {2}(?:async\s*)?(?:#)?([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]));
    for (const [, name] of src.matchAll(/this\.([A-Za-z_]\w*)\s*(?:=(?!=)|\?\?=|\|\|=)/g)) if (methods.has(name)) clashes.push(`${mod}: ${name}`);
  }
  expect([...new Set(clashes)]).toEqual([]);
});
