import { test, expect } from "bun:test";
import { wilson, levels, clean, heat, summarize, startOfDay, DAY, kindOf, rhythmOf, outputOf, span, keepOf, tabAfter, skillsOf, categoryOf } from "./lib.js";

const NOW = new Date(2026, 10, 12, 15).getTime(); // Thu 12 Nov 2026, 15:00 local
const s = (h, daysAgo, extra = {}) => ({
  h, id: `${h}${daysAgo}${Math.random()}`, start: NOW - daysAgo * DAY, end: NOW - daysAgo * DAY + 600000, repo: "/r/app", sub: false,
  models: { [`${h}-m`]: 1000 }, effort: "high", tok: 1000, tin: 100, tout: 100, tcr: 700, tcw: 100, cost: null,
  req: 5, tools: 10, toolErr: 0, aborts: 0, apiErr: 0, compactions: 0, commits: 1, ...extra,
});

test("wilson: bounds hold and small n stays wide", () => {
  expect(wilson(0, 0)).toBeNull();
  const w = wilson(3, 3);
  expect(w.p).toBe(1);
  expect(w.hi).toBe(1);
  expect(w.lo).toBeLessThan(0.5); // 3 of 3 isn't proof of 100%
  expect(wilson(300, 300).lo).toBeGreaterThan(0.98);
});

test("levels: zero is empty, quartiles of the rest", () => {
  const lvl = levels([0, 1, 2, 3, 4, 100]);
  expect(lvl(0)).toBe(0);
  expect(lvl(1)).toBe(1);
  expect(lvl(100)).toBe(4);
});

test("clean: abort, API error, compaction or 10%+ tool errors spoil a run", () => {
  expect(clean(s("omp", 0))).toBe(true);
  expect(clean(s("omp", 0, { aborts: 1 }))).toBe(false);
  expect(clean(s("omp", 0, { compactions: 1 }))).toBe(false);
  expect(clean(s("omp", 0, { toolErr: 1 }))).toBe(false);
  expect(clean(s("omp", 0, { tools: 0, toolErr: 0 }))).toBe(true);
});

test("heat: ends today, starts on a Monday, sub-agents don't count as sessions", () => {
  const cells = heat([s("omp", 0), s("omp", 0, { sub: true })], { weeks: 2, metric: "sessions", now: NOW });
  expect(cells.at(-1).t).toBe(startOfDay(NOW));
  expect(cells[0].wd).toBe(0);
  expect(cells.at(-1).sessions).toBe(1);
  expect(cells.at(-1).tokens).toBe(2000);
});

test("summarize: tiles, streak through yesterday, filters by harness", () => {
  const all = [s("omp", 1), s("omp", 2), s("claude", 1), s("claude", 40)];
  const r = summarize(all, { from: startOfDay(NOW) - 6 * DAY, to: NOW, harnesses: new Set(["omp"]) });
  expect(r.tiles.sessions).toBe(2);
  expect(r.tiles.streak).toBe(2); // yesterday and the day before; today has none yet
  expect(r.tiles.cacheHit).toBeCloseTo(0.875);
  expect(r.tiles.costKnown).toBe(false);
  expect(r.step).toBe(DAY);
});

test("scorecard: 3+ sessions per harness x model; a winner only when intervals separate", () => {
  const good = Array.from({ length: 40 }, (_, i) => s("omp", i % 5));
  const bad = Array.from({ length: 40 }, (_, i) => s("claude", i % 5, { aborts: 1, commits: 0 }));
  const r = summarize([...good, ...bad, s("pi", 1), s("pi", 2)], { from: NOW - 30 * DAY, to: NOW, harnesses: new Set(["omp", "claude", "pi"]) });
  expect(r.score.map((x) => x.h)).toEqual(["omp", "claude"]); // pi has only 2
  expect(r.best?.h).toBe("omp");
  expect(r.score[1].commit.p).toBe(0);
  const close = summarize([s("omp", 1), s("omp", 2), s("omp", 3), s("claude", 1), s("claude", 2), s("claude", 3, { aborts: 1 })],
    { from: NOW - 30 * DAY, to: NOW, harnesses: new Set(["omp", "claude"]) });
  expect(close.best).toBeNull();
});

test("same repos: only repos two harnesses worked in", () => {
  const all = [...[1, 2, 3].map((d) => s("omp", d, { repo: "/r/a" })), ...[1, 2, 3].map((d) => s("claude", d, { repo: "/r/b" })), ...[1, 2, 3].map((d) => s("claude", d, { repo: "/r/a" }))];
  const r = summarize(all, { from: NOW - 30 * DAY, to: NOW, harnesses: new Set(["omp", "claude"]), sameRepos: true });
  expect(r.score.find((x) => x.h === "claude").n).toBe(3);
});

test("kindOf: the tool mix names the work", () => {
  const tc = (o) => ({ tc: { edit: 0, read: 0, bash: 0, web: 0, agent: 0, other: 0, ...o } });
  expect(kindOf({})).toBe("chat");
  expect(kindOf(tc({ agent: 3, read: 50 }))).toBe("orchestrate");
  expect(kindOf(tc({ edit: 4, read: 16 }))).toBe("build");
  expect(kindOf(tc({ web: 6, read: 4 }))).toBe("research");
  expect(kindOf(tc({ bash: 9, read: 3 }))).toBe("debug");
  expect(kindOf(tc({ bash: 2, read: 9 }))).toBe("investigate");
});

test("cost per success counts failed runs' spend; kind filters the comparison", () => {
  const runs = [s("omp", 1, { cost: 2 }), s("omp", 2, { cost: 2 }), s("omp", 3, { cost: 2, aborts: 1 })];
  const r = summarize(runs, { from: NOW - 30 * DAY, to: NOW, harnesses: new Set(["omp"]) });
  expect(r.score[0].cps).toBe(3); // $6 over 2 clean runs
  expect(r.score[0].loops).toBe(10);
  expect(r.kinds.chat).toBe(3);
  expect(summarize(runs, { from: NOW - 30 * DAY, to: NOW, harnesses: new Set(["omp"]), kind: "build" }).score).toEqual([]);
});

test("cost anatomy: price per token and per output token, context read per token written", () => {
  const runs = [1, 2, 3].map((d) => s("omp", d, { cost: 1, tok: 1000, tin: 100, tcw: 100, tcr: 700, tout: 100 }));
  const x = summarize(runs, { from: NOW - 30 * DAY, to: NOW, harnesses: new Set(["omp"]) }).score[0];
  expect(x.per1M).toBeCloseTo(1000); // $3 over 3000 tokens
  expect(x.per1kOut).toBeCloseTo(10); // $3 over 300 output tokens
  expect(x.readPerOut).toBe(9);
  expect(x.perCommit).toBe(1);
});

test("rhythm: lengths binned, parallel runs counted, long resumed runs capped", () => {
  const at = (h, mins) => ({ start: NOW + h * 3600000, end: NOW + h * 3600000 + mins * 60000 });
  const r = rhythmOf([at(0, 3), at(0.01, 90), at(0.02, 60 * 48), at(30, 10)]);
  expect(r.lengths).toEqual([1, 1, 0, 0, 1, 0, 1]);
  expect(r.peakParallel).toBe(3);
  expect(r.longestMin).toBe(480); // a resumed run counts as 8h at most
});

test("output: commits and lines in the period, PRs merged by merge date, median time to merge", () => {
  const out = {
    commits: [{ t: NOW - DAY, repo: "/r/a", add: 10, del: 2 }, { t: NOW - 2 * DAY, repo: "/r/a", add: 5, del: 0 }, { t: NOW - 40 * DAY, repo: "/r/b", add: 99, del: 9 }],
    prs: [{ repo: "/r/a", n: 1, created: NOW - 3 * DAY, merged: NOW - 3 * DAY + 2 * 3600000, add: 1, del: 1, state: "merged" }, { repo: "/r/a", n: 2, created: NOW - DAY, merged: null, add: 1, del: 0, state: "open" }],
    worktrees: [{ repo: "/r/a", n: 3 }],
  };
  const o = outputOf(out, { from: NOW - 7 * DAY, to: NOW, step: DAY });
  expect([o.commits, o.add, o.del, o.activeDays]).toEqual([2, 15, 2, 2]);
  expect([o.opened, o.merged, o.mergeHours, o.worktrees]).toEqual([2, 1, 2, 3]);
  expect(o.repos[0]).toEqual({ repo: "/r/a", commits: 2, add: 15, del: 2 });
});

test("selection: spans days and hour blocks, and narrows the sums to what's picked", () => {
  const today = startOfDay(NOW);
  expect(span("days", [today - 2 * DAY, today - 2 * DAY], [today, today]).length).toBe(3);
  // 09:00-12:00 every day, dragged down the hour labels: 7 weekdays x 3 hours.
  const nine = span("slots", [[0, 6], [9, 9]], [[0, 6], [11, 11]]);
  expect(nine.length).toBe(21);
  const at = (daysAgo, hour) => s("omp", 0, { start: today - daysAgo * DAY + hour * 3600000 });
  const all = [at(0, 10), at(0, 15), at(1, 9), at(3, 11)];
  const slots = keepOf({ kind: "slots", keys: new Set(nine) });
  expect(summarize(all, { from: today - 6 * DAY, to: today + DAY, harnesses: new Set(["omp"]), keep: slots }).tiles.sessions).toBe(3);
  const days = new Set([today, today - DAY]);
  const r = summarize(all, { from: today - DAY, to: today + DAY, harnesses: new Set(["omp"]), keep: keepOf({ kind: "days", keys: days }), days: 2 });
  expect([r.tiles.sessions, r.tiles.days, r.tiles.activeDays]).toEqual([3, 2, 2]);
  const out = { commits: [{ t: today + 10 * 3600000, repo: "/r/a", add: 1, del: 0 }, { t: today + 15 * 3600000, repo: "/r/a", add: 1, del: 0 }] };
  expect(outputOf(out, { from: today, to: today + DAY, step: DAY, keep: slots }).commits).toBe(1);
});

test("tabAfter: ← / → walk the tabs (wrapping), but not while a date field has the caret", () => {
  const tabs = [["overview"], ["compare"], ["rhythm"]];
  expect(tabAfter(tabs, "overview", "right", false)).toBe("compare");
  expect(tabAfter(tabs, "overview", "left", false)).toBe("rhythm");
  expect(tabAfter(tabs, "rhythm", "right", false)).toBe("overview");
  expect(tabAfter(tabs, "compare", "left", true)).toBe(null); // typing a custom range: the caret's, not the tabs'
});

// Skills: what each is used for, how its sessions do, against the same harnesses' sessions without it.
const sk = (h, skills, { commits = 0, cost = 1, aborts = 0, sub = false, start = 1000, model = "opus" } = {}) =>
  ({ h, skills, commits, cost, aborts, apiErr: 0, compactions: 0, tools: 10, toolErr: 0, sub, start, models: { [model]: 1 } });

test("categoryOf: a skill's category from its name, else Other", () => {
  expect(categoryOf("ponytail-review")).toBe("Code review");
  expect(categoryOf("writing-plans")).toBe("Planning and design");
  expect(categoryOf("test-driven-development")).toBe("Testing and debugging");
  expect(categoryOf("clear-explanations")).toBe("Writing and explaining");
  expect(categoryOf("built-in-browser")).toBe("Browsing");
  expect(categoryOf("claude-api")).toBe("Other");
});

test("skillsOf: per skill, its sessions against the same harnesses' sessions without it", () => {
  const sessions = [
    sk("claude", { brainstorming: 2 }, { commits: 3, cost: 2 }),
    sk("claude", { brainstorming: 1, "writing-plans": 1 }, { commits: 1, cost: 4, aborts: 1 }),
    sk("claude", {}, { commits: 0, cost: 1 }),
    sk("claude", {}, { commits: 2, cost: 3 }),
    sk("omp", { "writing-plans": 1 }, { commits: 5, cost: 10 }),
    sk("omp", {}, { commits: 1, cost: 2 }),
    sk("claude", { brainstorming: 9 }, { sub: true }),        // a sub-agent: not counted
    sk("claude", { brainstorming: 9 }, { start: 99999 }),     // outside the period
  ];
  const { rows, tiles } = skillsOf(sessions, { from: 0, to: 5000 });
  const b = rows.find((r) => r.key === "brainstorming");
  expect(b.n).toBe(2);
  expect(b.commitsMed).toBe(2);           // median of 3 and 1
  expect(b.perCommit).toBe(1.5);          // $6 over 4 commits
  expect(b.costMed).toBe(3);              // median of 2 and 4
  expect(b.base.n).toBe(2);               // the two claude sessions without it (omp isn't its harness)
  expect(b.base.commitsMed).toBe(1);      // median of 0 and 2
  expect(b.base.perCommit).toBe(2);       // $4 over 2 commits
  expect(b.base.costMed).toBe(2);         // median of 1 and 3
  expect(b.clean.p).toBe(0.5);
  expect(b.few).toBe(true);               // under 5 sessions: too few to tell
  const w = rows.find((r) => r.key === "writing-plans");
  expect(w.n).toBe(2);
  expect(w.harnesses.map((x) => [x.key, x.n])).toEqual([["claude", 1], ["omp", 1]]);
  expect(w.base.n).toBe(4);               // 3 claude + 1 omp session without writing-plans
  expect(tiles).toMatchObject({ sessions: 6, skilled: 3, distinct: 2, top: "brainstorming" });
  expect(tiles.costSkilled).toBe(4);      // median of 2, 4, 10
  expect(tiles.costUnskilled).toBe(2);    // median of 1, 3, 2
});

test("skillsOf: no commits, or no recorded cost (Codex), leaves cost per commit empty; unknown commits are left out", () => {
  const one = (o) => skillsOf([sk("claude", { tdd: 1 }, o)], { from: 0, to: 5000 }).rows[0];
  expect(one({ commits: 0 }).perCommit).toBe(null);
  expect(one({ commits: 2, cost: null }).perCommit).toBe(null);
  expect(one({ commits: null }).commitsMed).toBe(null);
});

test("skillsOf: by category merges a session's skills in one category once; harnesses filter", () => {
  const sessions = [sk("claude", { brainstorming: 1, "writing-plans": 1 }), sk("omp", { "ponytail-review": 1 })];
  const { rows } = skillsOf(sessions, { from: 0, to: 5000, by: "category" });
  expect(rows.map((r) => [r.key, r.n])).toEqual([["Code review", 1], ["Planning and design", 1]]);
  expect(skillsOf(sessions, { from: 0, to: 5000, harnesses: new Set(["omp"]) }).rows.map((r) => r.key)).toEqual(["ponytail-review"]);
});

// Overview: what the spend got (commits, cost per commit), how it went (clean runs), each against the period before;
// the period day by day; and where the spend went, by project.
test("summarize: commits from top-level sessions, cost per commit from costed ones, clean share, vs the period before", () => {
  const all = [
    s("claude", 1, { cost: 4, commits: 3, where: "app" }),
    s("claude", 1, { cost: 2, commits: 1, sub: true, where: "app" }), // a sub-agent: its commit is already its parent's
    s("codex", 2, { cost: null, commits: 5, where: "api" }),           // no cost: its commits count, not in cost per commit
    s("claude", 2, { cost: 7, commits: 0, aborts: 1, where: "api" }),
    s("claude", 9, { cost: 3, commits: 1, where: "app" }),             // the period before
  ];
  const r = summarize(all, { from: startOfDay(NOW) - 6 * DAY, to: NOW, harnesses: new Set(["claude", "codex"]) });
  expect(r.tiles.commits).toBe(8);
  expect(r.tiles.perCommit).toBe(13 / 3);  // the Cost tile's $13 (sub-agent included) over the costed sessions' 3 commits
  expect(r.tiles.clean).toBeCloseTo(2 / 3);
  expect(r.tiles.cleanPrev).toBe(1);
  expect(r.tiles.costPrev).toBe(3);
  const day = r.buckets.find((b) => b.t === startOfDay(NOW - DAY));
  expect([day.sessions, day.cost, day.commits]).toEqual([{ claude: 1 }, { claude: 6 }, { claude: 3 }]); // the sub-agent's cost is the day's
  expect(r.buckets.find((b) => b.t === startOfDay(NOW - 2 * DAY)).commits).toEqual({ codex: 5, claude: 0 });
  expect(r.spend.map((x) => [x.key, x.sessions, x.cost, x.commits])).toEqual([["api", 2, 7, 5], ["app", 1, 6, 3]]);
  expect(r.spend.reduce((a, x) => a + x.cost, 0)).toBe(r.tiles.cost); // the rows add up to the Cost tile
  expect(r.spend.find((x) => x.key === "app").perCommit).toBe(2);        // its $6 (sub-agent included) over 3 commits
});

test("summarize: where the spend went keeps the top projects and folds the rest into one row", () => {
  const all = ["a", "b", "c", "d", "e", "f"].map((w, i) => s("claude", 1, { cost: 10 - i, where: w }));
  const r = summarize([...all, s("claude", 1, { cost: 1, where: null })], { from: startOfDay(NOW) - 6 * DAY, to: NOW, harnesses: new Set(["claude"]) });
  expect(r.spend.map((x) => x.key)).toEqual(["a", "b", "c", "d", null]);
  expect(r.spend.at(-1)).toMatchObject({ sessions: 3, cost: 6 + 5 + 1 });
});

test("summarize: compares with the period before only when the history covers it", () => {
  const from = startOfDay(NOW) - 6 * DAY, h = new Set(["omp"]);
  expect(summarize([s("omp", 1), s("omp", 9)], { from, to: NOW, harnesses: h }).tiles.before).toBe(false); // starts mid-way
  expect(summarize([s("omp", 1), s("omp", 13)], { from, to: NOW, harnesses: h }).tiles.before).toBe(true);
  expect(summarize([s("omp", 1), s("claude", 30)], { from, to: NOW, harnesses: h }).tiles.before).toBe(true); // any harness's history
});

// Compare's radars: per harness and main model (10+ sessions), the clean-run rate in each kind of work it did 3+ times.
test("strengthsOf: clean rate per kind for big enough pairs, best and weakest of the measured kinds", async () => {
  const { strengthsOf } = await import("./lib.js");
  const build = { tc: { edit: 8, read: 2, bash: 0, web: 0, agent: 0, other: 0 }, tools: 10 };
  const debug = { tc: { edit: 0, read: 3, bash: 7, web: 0, agent: 0, other: 0 }, tools: 10 };
  const sessions = [
    ...Array.from({ length: 6 }, (_, i) => s("claude", 1, { ...build, aborts: i < 1 ? 1 : 0 })),  // build: 5 of 6 clean
    ...Array.from({ length: 5 }, (_, i) => s("claude", 1, { ...debug, aborts: i < 2 ? 1 : 0 })),  // debug: 3 of 5
    s("claude", 1, { tc: { edit: 0, read: 6, bash: 0, web: 4, agent: 0, other: 0 }, tools: 10 }), // one research: too few
    ...Array.from({ length: 9 }, () => s("omp", 1, build)),                                        // 9 sessions: too few to draw
  ];
  const [c, ...rest] = strengthsOf(sessions);
  expect(rest).toEqual([]);
  expect([c.h, c.model, c.n]).toEqual(["claude", "claude-m", 12]);
  expect(c.kinds.build).toMatchObject({ n: 6, ok: 5, clean: 5 / 6 });
  expect(c.kinds.build.lo).toBeLessThan(c.kinds.build.clean);      // the low end of its range ranks best and weakest
  expect(c.kinds.research.lo).toBe(null);
  expect(c.kinds.debug).toMatchObject({ n: 5, ok: 3, clean: 0.6 });
  expect(c.kinds.research).toMatchObject({ n: 1, clean: null }); // under 5: not measured
  expect([c.best, c.worst]).toEqual(["build", "debug"]);
  // best and weakest go by how sure the rate is (the low end of its interval), not the raw rate
  const few = strengthsOf([...Array.from({ length: 5 }, () => s("omp", 1, build)),
    ...Array.from({ length: 30 }, (_, i) => s("omp", 1, { ...debug, aborts: i < 3 ? 1 : 0 }))])[0];
  expect([few.best, few.worst]).toEqual(["debug", "build"]); // 27/30 beats 5/5
});
