import { test, expect } from "bun:test";
import { parseFrontMatter, mergeSkills, rankSkills, sortFiles, parseListing, resolveLink, pickPlugins } from "./lib.js";

test("plugins: the user install wins, missing folders are skipped", () => {
  const installed = {
    "ctx7@official": [{ scope: "project", installPath: "/p/ctx7", version: "unknown" }, { scope: "user", installPath: "/u/ctx7", version: "1.2" }],
    "gone@official": [{ scope: "project", installPath: "/missing" }],
    "solo": { scope: "project", installPath: "/p/solo" },
  };
  const have = new Set(["/p/ctx7", "/u/ctx7", "/p/solo"]);
  expect(pickPlugins(installed, (p) => have.has(p))).toEqual([
    { id: "ctx7@official", name: "ctx7", marketplace: "official", root: "/u/ctx7", version: "1.2" },
    { id: "solo", name: "solo", marketplace: "", root: "/p/solo", version: "" },
  ]);
});

test("front matter: plain, quoted, colons, comments", () => {
  const { meta, body } = parseFrontMatter(`---
name: brainstorming
description: "You MUST use this: before \\"creative\\" work - it's key"
title: 'it''s: fine' # trailing comment
plain: Use when: X happens # gone
tag: C# and F#
---
# Body
`);
  expect(meta.name).toBe("brainstorming");
  expect(meta.description).toBe('You MUST use this: before "creative" work - it\'s key');
  expect(meta.title).toBe("it's: fine");
  expect(meta.plain).toBe("Use when: X happens");
  expect(meta.tag).toBe("C# and F#");
  expect(body).toBe("# Body\n");
});

test("front matter: folded, literal and multi-line values", () => {
  const { meta } = parseFrontMatter(`---\r
name: eval-audit\r
description: >\r
  Audit an LLM eval pipeline: missing analysis,\r
  vanity metrics.\r
\r
  Second paragraph.\r
literal: |-\r
  line one\r
    indented\r
plain:\r
  continues on\r
  the next line\r
quoted: "starts here\r
  and ends here"\r
metadata:\r
  author: someone\r
empty:\r
---\r
`);
  expect(meta.name).toBe("eval-audit");
  expect(meta.description).toBe("Audit an LLM eval pipeline: missing analysis, vanity metrics.\nSecond paragraph.");
  expect(meta.literal).toBe("line one\n  indented");
  expect(meta.plain).toBe("continues on the next line");
  expect(meta.quoted).toBe("starts here and ends here");
  expect(meta.empty).toBe("");
});

test("front matter: missing, empty, unterminated", () => {
  expect(parseFrontMatter("# Just markdown\n---\n")).toEqual({ meta: {}, body: "# Just markdown\n---\n" });
  expect(parseFrontMatter("---\n---\nbody")).toEqual({ meta: {}, body: "body" });
  expect(parseFrontMatter("---\nname: x\nno end").meta).toEqual({});
  expect(parseFrontMatter("\uFEFF---\nname: x\n---").meta.name).toBe("x");
});

test("merge dedupes by real path, keeps source order, drops nested SKILL.md", () => {
  const order = ["Agents", "Claude", "OpenCode", "Codex", "Project"];
  const skills = mergeSkills([
    { source: "Claude", dir: "/h/.claude/skills/a", real: "/r/a" },
    { source: "Agents", dir: "/h/.agents/skills/a", real: "/r/a" },
    { source: "OpenCode", dir: "/h/.oc/skills/a", real: "/r/a" },
    { source: "Agents", dir: "/h/.agents/skills/a", real: "/r/a" },
    { source: "Codex", dir: "/h/.codex/skills/b", real: "/h/.codex/skills/b" },
    { source: "Codex", dir: "/h/.codex/skills/b/templates/t", real: "/h/.codex/skills/b/templates/t" },
    { source: "Claude", dir: "/h/.claude/skills/broken", real: "" },
  ], order);
  expect(skills.map((s) => [s.real, s.sources])).toEqual([["/r/a", ["Agents", "Claude", "OpenCode"]], ["/h/.codex/skills/b", ["Codex"]]]);
});

test("ranking: name hits first, all words must match, fuzzy last", () => {
  const skills = [
    { name: "writing-plans", description: "Use for multi-step tasks" },
    { name: "brainstorming", description: "Use before creative work" },
    { name: "tdd", description: "Test first. Avoid brainstorming loops" },
    { name: "plan-review", description: "Review a plan" },
  ];
  const names = (q) => rankSkills(skills, q).map((s) => s.name);
  expect(names("")).toEqual(["brainstorming", "plan-review", "tdd", "writing-plans"]);
  expect(names("brainstorming")).toEqual(["brainstorming", "tdd"]);
  expect(names("plan")).toEqual(["plan-review", "writing-plans"]);
  expect(names("use creative")).toEqual(["brainstorming"]);
  expect(names("brst")).toEqual(["brainstorming"]);
  expect(names("zzz")).toEqual([]);
});

test("files: listing parse and grouping order", () => {
  const out = parseListing(`  10 /s/x/scripts/run.sh
  20 /s/x/SKILL.md
  30 /s/x/assets/logo.png
  40 /s/x/visual-companion.md
  50 /s/x/references/a.md
  60 /s/x/lib/util.py
 210 total`, "/s/x");
  expect(out.map((f) => f.path)).toEqual(["SKILL.md", "references/a.md", "visual-companion.md", "scripts/run.sh", "lib/util.py", "assets/logo.png"]);
  expect(out[0].size).toBe(20);
  expect(sortFiles([{ path: "b.md" }, { path: "SKILL.md" }]).map((f) => f.path)).toEqual(["SKILL.md", "b.md"]);
});

test("links resolve to sibling files", () => {
  const paths = ["SKILL.md", "references/foo.md", "scripts/run.sh", "visual-companion.md"];
  expect(resolveLink("references/foo.md#usage", paths, "SKILL.md")).toBe("references/foo.md");
  expect(resolveLink("./visual-companion.md", paths, "SKILL.md")).toBe("visual-companion.md");
  expect(resolveLink("../scripts/run.sh", paths, "references/foo.md")).toBe("scripts/run.sh");
  expect(resolveLink("file:///Users/me/skills/x/references/foo.md", paths, "SKILL.md")).toBe("references/foo.md");
  expect(resolveLink("https://example.com/references/foo.md", paths, "SKILL.md")).toBe(null);
  expect(resolveLink("missing.md", paths, "SKILL.md")).toBe(null);
});
