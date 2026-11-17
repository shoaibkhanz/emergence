// The library's pure parts: repo keys, the index entries, grouping and search, file names, the trash.
import { test, expect } from "bun:test";
import { repoKey, repoName, declaredRepos, observe, sections, search, freeName, expired, ago, TRASH_DAYS, knownRepos, toggleRepo, shortTitle } from "./library.js";

const DAY = 86400000;

test("repoKey: one key per repo, whichever remote spelling or worktree; the common dir when there's no remote", () => {
  expect(repoKey("git@github.com:acme/shop.git", "/x/.git")).toBe("github.com/acme/shop");
  expect(repoKey("https://github.com/acme/shop", "/y/.git")).toBe("github.com/acme/shop");
  expect(repoKey("ssh://git@gitlab.com/acme/api.git/", null)).toBe("gitlab.com/acme/api");
  expect(repoKey("", "/Users/me/code/notes/.git")).toBe("/Users/me/code/notes/.git");
  expect(repoName("github.com/acme/shop")).toBe("shop");
  expect(repoName("/Users/me/code/notes/.git")).toBe("notes");
  expect(repoName("/Users/me/code/notes")).toBe("notes");
});

test("declaredRepos: the agent's herdr_repos graph attribute, comma separated, ~ expanded", () => {
  expect(declaredRepos({ herdr_repos: "~/code/shop, /srv/api" }, "/Users/me")).toEqual(["/Users/me/code/shop", "/srv/api"]);
  expect(declaredRepos({}, "/Users/me")).toEqual([]);
});

test("observe: a new file gets an entry; a changed sum moves updated and says who; repos from the file are kept and merged", () => {
  const now = 1000 * DAY;
  const a = observe(undefined, { name: "shop-checkout.excalidraw", sum: "s1", title: "Checkout", nodes: 9, repos: [{ key: "k1", path: "/a" }], now });
  expect(a).toMatchObject({ title: "Checkout", nodes: 9, created: now, updated: now, by: "agent", edited: "agent", pinned: false, repos: [{ key: "k1", path: "/a" }] });
  const same = observe(a, { name: "shop-checkout.excalidraw", sum: "s1", title: "Checkout", nodes: 9, repos: [], now: now + 5 });
  expect(same.updated).toBe(now); // nothing changed: nothing moves, and repos the file no longer says stay
  expect(same.repos).toEqual([{ key: "k1", path: "/a" }]);
  const canvas = observe({ ...a, wrote: "s2" }, { name: "shop-checkout.excalidraw", sum: "s2", title: "Checkout", nodes: 10, repos: [{ key: "k2", path: "/b" }], now: now + 9 });
  expect(canvas).toMatchObject({ updated: now + 9, edited: "canvas", nodes: 10 });
  expect(canvas.repos.map((r) => r.key)).toEqual(["k1", "k2"]);
  expect(observe({ ...a, title: "Renamed", named: true }, { name: "x", sum: "s3", title: "Checkout", nodes: 1, repos: [], now }).title).toBe("Renamed"); // a rename in the library sticks
});

const E = (name, o) => ({ name, title: name, repos: [], pinned: false, updated: 0, nodes: 1, tags: [], ...o });
const entries = [
  E("a", { repos: [{ key: "k1" }], updated: 5 }),
  E("b", { repos: [{ key: "k1" }, { key: "k2" }], updated: 9 }),
  E("c", { repos: [{ key: "k2" }], updated: 7, pinned: true }),
  E("d", { updated: 3 }),
  E("e", { repos: [{ key: "k1" }], updated: 1, pinned: true }),
];

test("sections: this repo first (pinned on top, then newest), other repos by recency, Unfiled last; each diagram once", () => {
  const s = sections(entries, "k1", "repo");
  expect(s.map((x) => [x.key, x.rows.map((r) => r.name)])).toEqual([["k1", ["e", "b", "a"]], ["k2", ["c"]], [null, ["d"]]]);
  expect(sections(entries, "k1", "pinned").flatMap((x) => x.rows.map((r) => r.name)).sort()).toEqual(["c", "e"]);
  expect(sections(entries, "k9", "repo").map((x) => x.key)).toEqual(["k1", "k2", null]); // not in a known repo: by each group's newest (b sits under its first repo, k1)
});

test("search: title beats tag beats repo; nothing typed lists nothing", () => {
  const list = [E("x", { title: "Checkout flow" }), E("y", { title: "Data", tags: ["checkout"] }), E("z", { title: "Auth", repos: [{ key: "github.com/acme/checkout" }] })];
  expect(search(list, "checkout").map((r) => r.name)).toEqual(["x", "y", "z"]);
  expect(search(list, "auth").map((r) => r.name)).toEqual(["z"]);
  expect(search(list, "  ")).toEqual([]);
});

test("freeName: <repo>-<topic>.excalidraw, never one that's taken", () => {
  expect(freeName("shop", "Checkout Flow!", [])).toBe("shop-checkout-flow.excalidraw");
  expect(freeName("shop", "checkout flow", ["shop-checkout-flow.excalidraw"])).toBe("shop-checkout-flow-2.excalidraw");
  expect(freeName(null, "", [])).toBe("drawing.excalidraw");
});

test("trash: only what you deleted, gone after 30 days; nothing else ever expires", () => {
  const now = 100 * DAY;
  expect(TRASH_DAYS).toBe(30);
  expect(expired({ deleted: now - 31 * DAY }, now)).toBe(true);
  expect(expired({ deleted: now - 29 * DAY }, now)).toBe(false);
  expect(expired({ updated: 0 }, now)).toBe(false);
});

test("ago: short relative times", () => {
  const now = 10 * DAY;
  expect(ago(now - 30000, now)).toBe("now");
  expect(ago(now - 2 * 3600000, now)).toBe("2h");
  expect(ago(now - DAY - 1000, now)).toBe("Yesterday");
  expect(ago(now - 3 * DAY, now)).toBe("3d");
  expect(ago(now - 9 * DAY, now)).toBe("1w");
});

test("knownRepos: every repo any diagram names, once each, this repo first, then by name", () => {
  const here = { key: "github.com/acme/zeta", path: "/z" };
  const list = knownRepos([E("a", { repos: [{ key: "github.com/acme/shop" }, { key: "github.com/acme/api" }] }), E("b", { repos: [{ key: "github.com/acme/shop" }] })], here);
  expect(list.map((r) => r.key)).toEqual(["github.com/acme/zeta", "github.com/acme/api", "github.com/acme/shop"]);
  expect(knownRepos([], null)).toEqual([]);
});

test("toggleRepo: adds a repo the diagram lacks, removes one it has, never edits the list it's given", () => {
  const repos = [{ key: "k1" }];
  expect(toggleRepo(repos, { key: "k2" }).map((r) => r.key)).toEqual(["k1", "k2"]);
  expect(toggleRepo(repos, { key: "k1" })).toEqual([]);
  expect(repos).toEqual([{ key: "k1" }]);
});

test("shortTitle: a page tab shows the topic before the colon or dash; a plain title stays whole", () => {
  expect(shortTitle("Side chats: how a side chat opens beside an agent")).toBe("Side chats");
  expect(shortTitle("Checkout — how an order is placed")).toBe("Checkout");
  expect(shortTitle("How Emergence works")).toBe("How Emergence works");
  expect(shortTitle("ratio 1:2 test")).toBe("ratio 1:2 test"); // only a colon followed by a space splits
  expect(shortTitle(": oops")).toBe(": oops");
});
