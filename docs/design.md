# herdr-mods — design (moved)

Three native mods for the Herdr app (`herdr-app` 0.1.15, gpui-kit) that make
multi-agent work legible: what is running where, what it shipped, and what
skills it has to draw on.

## Context (verified)

- Herdr app mods are JS views drawn natively by GPUI (`~/.config/herdr-app/AGENTS.md`).
  They read live `spaces()`, `agents()`, `panes()`, `terminals()` (with `parent`
  for sub-agents started via `hc run`), `focused()` (with `cwd`), and run programs
  through `exec`.
- Overlays already exist natively: `openOverlay({kind: "popup" | "dialog" | "window"})`.
  Windows float, drag, stay open across tab switches and can be kept across restarts.
- `gh` is installed and signed in (`shoaibkhanz`); `glab` is installed but not in use.
- Installed third-party `annotator` mod covers *local* review → send to agent. It
  only reads/replies to the current branch's PR threads; no PR browsing, no new
  GitHub line comments, no delete. It stays; this work does not touch it.

## Decision: no ZenTerm

ZenTerm is a separate libghostty terminal app. Its floats/drawers are what Herdr's
`openOverlay` windows and floating `peek` blocks already provide, inside the
runtime that owns the agents. Adopting it would split the agent model across two
terminals for no capability gain. Skipped.

## The three mods

### 1. `agent-graph` — the factory floor

Opened with ⌘⇧G as a large popup over the window (Esc closes).

Canvas, left → right, one column per level:

```
repo ──▶ worktree · branch  [PR #123 open · ✓ checks] ──▶ agent ──▶ sub-agent
```

- **Repo** node: repo name, machine if remote. Worktrees of the same repo
  (`git rev-parse --git-common-dir`) group under one repo node.
- **Worktree** node: branch, path tail, ahead/behind, PR chip: `none`, `draft`,
  `open`, `merged`, `closed`, plus review decision. One `gh pr list --state all`
  per repo, cached 60 s.
- **Agent** node: program icon, title, status dot (working pulses; blocked is
  loud), tab name. Sub-agents hang off their `parent`.
- Sort is attention-first: blocked > done > working > idle.
- Click agent → `agent.focus` and close. Click PR chip → opens `pr-review` at
  that PR (`setShared("pr-review.open", {repo, number})`).
- Pan (drag / scroll), zoom (⌘-scroll), fit (F). Edges are `PathBuilder` curves,
  coloured by the downstream agent's status.
- Layout is deterministic layered columns; no force simulation.

### 2. `pr-review` — PRs for whatever repo you are looking at

Opened with ⌘⇧U as a floating window (kept, draggable). It follows `focused().cwd`:
switching tabs/panes re-targets it to that pane's repo.

- **Left rail:** "This branch vs main" entry, then PRs (open first, then closed /
  merged), search box (`gh pr list --search`), state filter.
- **File list:** changed files with +/− counts and comment badges.
- **Diff:** unified, syntax-tinted, add/delete row tints. Click a line, shift-click
  (or drag) to select a range on one side.
- **Comments (GitHub, PR entries only):** create a single or multi-line review
  comment on the selection, reply, edit, delete own comments, resolve / unresolve
  threads. Inline thread cards under their line; outdated threads labelled.
- "This branch vs main" is read-only local `git diff <merge-base>`; comments need a PR.
- All GitHub calls go through `gh` (`gh pr list/diff`, REST `pulls/{n}/comments`
  create/patch/delete, GraphQL `reviewThreads`, `resolveReviewThread`). Provider
  code lives in `github.js`; GitLab later as `gitlab.js` with the same functions,
  picked by remote host. No GitLab in v1.

### 3. `skills` — your skill library, readable

Opened with ⌘⇧K as a palette popup.

- Sources: `~/.agents/skills`, `~/.claude/skills`, `~/.config/opencode/skills`,
  `~/.codex/skills`, plus `.agents/skills` / `.claude/skills` in the focused repo.
  Deduped by real path (most `~/.claude/skills` entries are symlinks); each row
  shows which harnesses carry it.
- Palette: search over name + description (from SKILL.md front matter), list
  left, SKILL.md preview right.
- Enter / "Open" pops the skill into its own floating window: rendered SKILL.md,
  a file strip for `references/` (rendered markdown) and `scripts/` (read-only
  syntax-highlighted code). Several skill windows can be open side by side.
- Read-only. No install/sync (that is skillshare's job).

## Design language

Inspired by Beautiful UI (beautifului.dev): Task Rows, Tool Chips, Diff Table,
Context Cards. Quiet surfaces; colour carries status only.

- **Colour:** only `theme()` tokens, so every mod follows the user's theme.
  Surfaces `background`/`surface`/`raised`; text `foreground`/`muted`/`dim`;
  hairlines `border`; status `working`/`blocked`/`done`/`idle`; one `accent` for
  selection and primary action.
- **Type:** Geist for UI, Geist Mono for paths, ids, code. Scale 11 (meta) /
  12 (secondary) / 13 (body) / 15 (titles). Semibold for titles only.
- **Space:** 4 px grid. Rows 32 px, chips 20 px, card padding 12, section gap 16.
- **Shape:** radius 6 chips, 10 cards and nodes, overlay frame from Herdr.
- **Motion:** native only (`.loop` opacity on working dots, `.transition` on hover);
  never a timer for animation.
- Every surface has empty, loading and error states written as one quiet line.

## Repo layout

```
herdr-mods/
  mods/agent-graph/  mods/pr-review/  mods/skills/
  keys.json          # bindings to merge into ~/.config/herdr-app/keys.json
  install.sh         # links mods into ~/.config/herdr-app/mods, merges keys
  docs/specs/
```

## Verification

- `herdr-app check mods/<name>` passes for each mod.
- `herdr-app shot` screenshots inspected for spacing/type on the live window.
- `pr-review` reads verified against a real repo. Writes (comment, delete,
  resolve) only against a repo the user names; never on real PRs otherwise.

## Out of scope (v1)

GitLab; sending PR comments to agents (annotator does it); skill install/sync;
graph history/replay.
