# Sidebar: worktrees under spaces, three sizes, keyboard

Status: approved in conversation 2026-11-13, awaiting review of this written spec.
Mockups (local, not committed): `.superpowers/brainstorm/*/content/{sidebar-look-v4,collapse-thin,design-overview}.html`.

## Goal

The sidebar becomes the fast way to see and reach every worktree and every agent waiting on you, from the keyboard
as well as the mouse, and folds down without losing that information.

Success:

- Every worktree of an open repo is listed under its space, open or not, with its agents' state on the row.
- ⌘B puts the keyboard in the sidebar; arrows, ↵ and ctrl-h/j/k/l move through it and back to the terminal.
- Folded, it still says which space needs you (48px rail, or 20px dots).
- Nothing the sidebar does today is lost: click, right-click menu, drag to reorder, remote machines, Settle,
  "Working N" opening the graph, the Settled shelf, ⌘] / ⌘[ walking the inbox first.

Non-goals: the mods settings page (its own spec, after this ships); PR badges on worktree rows; new git operations
(remove or create worktrees stay in Herdr's `worktree` dialog and ⌘E).

## 1. What you see

Look: "Quiet tree" (`sidebar-look-v4.html`, option A). Theme tokens only, Geist 11/12/13 on a 4px grid, no always-on
animation (the working spinner is the existing one).

**Open, 268px**, top to bottom:

- Brand (workspace-chrome, unchanged).
- **Spaces** (spaces-plus). Header "Spaces" and "+" as today. Each space row as today: chevron, soft avatar, name,
  repo · branch, ↑ahead ↓behind. Under a space whose folder is a git repo, one 28px row per worktree of that repo
  (`git worktree list`), indented on a 1px guide:
  - branch icon, branch name (or the folder name when detached), ↑ahead ↓behind, then one state mark:
    amber dot = needs you (blocked), spinner = working, check = done, nothing = idle or no agent;
  - the worktree the space itself shows is not repeated as a child;
  - a worktree with no space yet is greyed and has no state mark;
  - an open worktree's row is the row of the space showing it (today's nesting), so it keeps that space's avatar
    colour, right-click menu and drag;
  - a space with worktrees has a chevron; folded, its row's tail reads "N worktrees".
- **Inbox** (inbox). Header "Inbox N" and the ⌘⇧J chip as today. Each agent is a two-line row: program mark, branch,
  "Needs you" / "Done · 4m" right-aligned; the task title below. Settle on hover, "Working N", the Settled shelf and
  "All caught up" stay.
- Footer (workspace-chrome, unchanged).

**Rail, 48px**: brand, footer and the Inbox list hidden. One 32×26 cell per space (avatar letter, today's
`compact()` cell) with a 7px dot in the corner, amber when its agents need you, blue while working. The space in
front is highlighted. The Inbox block shows only a round amber count badge at the bottom (hidden at 0).

**Dots, 20px**: one 8px rounded square per space in its colour, ringed amber / blue as the rail's dot, the space in
front at full opacity and the rest dimmed; the Inbox count as a small amber number at the bottom.

Clicking a rail cell or dot selects that space; clicking the badge opens the sidebar.

**Icons**: all Emergence SVGs move to Lucide at stroke-width 1.5, matching Herdr's workspace-chrome. That redraws the
stroke-2 sets in `mods/pr-review`, `mods/skills` and `mods/agent-graph` (same names, same shapes, thinner line;
`agent-graph/check.svg` from 3 to 1.5). tabs-plus `win-*` (16-unit, stroke 1) stay.

## 2. Sizes and keys

```
open ──⌘B──▶ last folded size (rail or dots)
folded ─⌘B─▶ open + keyboard
open ─⌘⌥B─▶ rail ─⌘⌥B─▶ dots ─⌘⌥B─▶ open
```

| Key | Where | Does |
|---|---|---|
| ⌘B | anywhere in the layout | folded → open and focus the Spaces list; open but not focused → focus it; open and focused → fold to the last folded size (default rail) |
| ⌘⌥B | anywhere in the layout | one size thinner, wrapping to open; the size it lands on becomes the last folded size |
| ↑ / ↓ | Spaces, Inbox | move the cursor (amber 1px inset ring); it wraps at neither end |
| → / ← | Spaces | unfold / fold the space under the cursor; ← on a worktree moves to its space |
| ↵ | Spaces | space or open worktree: `space.select`; greyed worktree: `space.new {folder, machine}` |
| ↵ | Inbox | `agent.focus` on that agent (today's click) |
| ctrl-j / ctrl-k | Spaces, Inbox | `pane.go` down / up: between Spaces and Inbox |
| ctrl-l, Esc | Spaces, Inbox | `pane.go` right: back to the most recently focused pane, i.e. the terminal you came from |
| ctrl-h | leftmost terminal | `pane.go` left into the sidebar, when ctrl-h/j/k/l are bound to nav-keys or `pane.go` |

⌘⇧B was the first choice for "thinner" but the person's keys file already binds it (Blueprint split), and Emergence
never shadows a key the person owns; ⌘⌥B is free in Herdr's defaults and that file.

The cursor starts on the row of the space in front. Keys reach a block only while it holds the keyboard; clicks and
drags behave as today whether or not it does.

## 3. Which part does what

Approach: grow the blocks that exist (chosen over one new `sidebar` mod, which would rebuild drag-reorder, machines
and the inbox and risk regressions, and over a separate worktree block, which would put worktrees beside spaces
instead of under them).

- **spaces-plus** (`mods/spaces-plus`)
  - `mod.json`: `"focusable": true`.
  - `init`: `this.fh = cx.focus_handle()`; a `nextCommand()` loop: `"focus"` → `this.fh.focus()`.
  - Root: `.track_focus(this.fh).on_key_down(...)` for the keys in section 2; ctrl-h/j/k/l and Esc call
    `run("pane.go", {direction})` here, so they work without any keys.json entry.
  - Worktree rows, folding (`localStorage` `folded`: space ids), cursor, rail and dots renders.
  - Publishes `setShared("spaces.focused", bool)` when its focus changes; tabs-plus reads it for ⌘B.
  - New `lib.js` (pure): parse `git worktree list --porcelain`; parse branch tracking counts; build the tree
    (spaces + worktrees → ordered rows with depth, open / greyed, which space shows which worktree); move the cursor.
    `lib.test.js` beside it, as in pr-review and usage.
- **inbox** (`mods/inbox`)
  - `mod.json`: `"focusable": true`; focus handle, `nextCommand()` loop and keys as spaces-plus (↑ ↓ ↵, ctrl-h/j/k/l,
    Esc); publishes `inbox.focused` the same way (⌘B counts the sidebar as focused when either is true).
  - Two-line rows; count badge in rail and dots sizes.
- **tabs-plus** (`mods/tabs-plus`)
  - `rail()` (⌘B) gains the new behaviour and `thinner()` (⌘⌥B) is added, over `shared("sidebar.size")` = `"open" | "rail" | "dots"`
    and `shared("sidebar.folded")` = last folded size. Folding hides brand and footer and resizes the sidebar to 48
    or 20; opening restores `shared("sidebar.width")` (default 268), shows them, and runs `spaces-plus.focus`.
  - The brand's own collapse button (workspace-chrome, 76px) is left as Herdr ships it.
- **keys.json / install.sh**: `layout:emergence` gains `"cmd-alt-b": "tabs-plus.thinner"`; `cmd-b` keeps
  `tabs-plus.rail` (the command keeps its name and gains the new behaviour, so no migration). `free()` rules unchanged.

## 4. Where the data comes from

- **Worktrees**: per repo (the common git dir spaces-plus already resolves in `check()`), on that space's machine:
  `git worktree list --porcelain`, and `git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads` for
  every branch's ahead / behind in one call. Two calls per repo, not per worktree.
- **When**: with the existing `check()` cycle: the `watchFolder` on the repo, and the 60s fallback.
- **State on a row**: `space.status` of the space showing that worktree (blocked > working > done > idle). No agent
  matching by folder.
- **Remote machines**: the same commands with `on: machine`. Unreachable or erroring: only open spaces show, as today.
- Prunable or missing worktrees (`prunable` in the porcelain output, or a missing folder) are not listed.

## 5. Edge cases

- Dozens of worktrees: the list scrolls; fold the space. No cap.
- A worktree open in a space whose main checkout has no space: a top-level space as today, with no children.
- Two spaces showing the same folder: the first in space order owns the row; the other stays a plain space.
- Bare repos: list linked worktrees only.
- Empty Inbox: "All caught up"; ctrl-j still lands there and ↑/↓ do nothing.
- Sidebar hidden entirely (another layout, `layout.toggle:sidebar`): ⌘B shows it open, as `rail()` does today.
- The cursor's row disappears (a worktree removed, a space closed): the cursor moves to the nearest row above.

## 6. Docs and images

At the end, with the code:

- **README**:
  - A **Keys** section listing every Emergence shortcut in one table: ⌘E (Jump); ⌘⇧A Agents, ⌘⇧R PRs, ⌘⇧K Library,
    ⌘⇧U Usage, ⌘⇧J next inbox agent, ⌘⇧O worktrees; ⌘B and ⌘⌥B (sidebar); the sidebar keys from section 2; the
    in-panel keys (↑/↓, ←/→, ↵, Esc, ⌘F in PRs); and ctrl-h/j/k/l with nav-keys (optional). Which act only in the
    `emergence` layout is marked. The scattered key mentions in the Jump and nav-keys sections point to it.
  - The **Sidebar** section rewritten for worktrees, the three sizes and the keyboard, with a new screenshot
    `docs/images/sidebar.png`.
- **RECIPE.md**: the sidebar parts of "What you see", "How it behaves" and the Keys bullets; ⌘⌥B.
- **docs/platform-notes.md**: `focusable` + `pane.go` confirmed both ways (terminal → sidebar block and back),
  `exec(cmd, args)` signature, and that `herdr-app check` does not catch a missing import (a render-time
  `ReferenceError`).
- **Screenshot**: the real mods in the person's Herdr, three sizes (open with the cursor on a worktree, rail, dots)
  side by side in one image, synthetic data only (sandbox repos and synthetic agents per platform-notes; no real
  names, repos or task titles), cropped to the sidebar. Not under `/tmp` in the repo.

## 7. Checks

- `bun test` in `mods/spaces-plus`: porcelain parsing (main, linked, detached, bare, prunable), tracking counts
  (ahead, behind, gone, none), tree building (open vs greyed, the shown worktree not repeated, two spaces on one
  folder, missing main checkout), cursor movement across folds.
- `herdr-app check` on every changed mod; `bash -n install.sh`; installer cases (fresh, old `rail`, user-owned
  `cmd-alt-b`).
- Live in the person's Herdr before any commit: each key in section 2, the three sizes, ⌘B from a panel and from the
  terminal, ctrl-h in and ctrl-l out, ↵ on a greyed worktree opening a space, remote machine (if one is connected),
  `herdr-app status` with no errors.
