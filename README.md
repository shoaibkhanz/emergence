# herdr-mods

Native mods for the [Herdr app](https://herdr.dev) for running many coding agents at once.
They live as side panels in the tab bar, next to Herdr's Files and Changes.

| Panel | Key | What it shows |
|---|---|---|
| Agents (`agent-graph`) | ⌘⇧G | Every agent on a canvas: repo → worktree/branch (with its PR) → agent → sub-agents. Click an agent to jump to it, a PR chip to review it, a repo to list every worktree it has. Drag a card to move it, empty space to pan; zoom with the mouse wheel, the − / + corner control, ⌘-scroll or - / = (a trackpad scroll pans), click the % to fit; R resets the arrangement. |
| PRs (`pr-review`) | ⌘⇧U | Follows the focused pane's repo: PRs (open/closed, search) and the branch vs main. The changed files as a folder tree with +/− and comment counts; one file's diff at a time (↑/↓ step files). Select lines (click, shift-click, drag), then comment from the box docked under the diff, tagged Statement · Question · Nit · Minor · Major (posted as a shields.io badge). Reply, edit, delete, resolve. |
| Library (`skills`) | ⌘⇧K | Skills: every skill across `~/.agents`, `~/.claude`, OpenCode, Codex and the current repo. Plugins: installed Claude Code plugins and the skills they ship. Open one in the skill window: SKILL.md, references, scripts (one window, reused; the corner button makes it bigger). |
| Usage (`usage`) | ⌘⇧M | How you work across omp, Claude Code, Codex, OpenCode and pi, read from their own session logs and your git history on this machine (nothing leaves it). Last 7/30/90 days, a year, or two dates of your choice. **Overview**: sessions, active days, tokens, cost, a year calendar, where the tokens go, what the work was. **Harnesses**: tokens over time, models, effort. **Compare**: per harness × model, success rate (with its 95% interval), cost per clean run and tool loops, a success-vs-cost chart, and the cost anatomy (token mix, $ per 1M tokens and per 1K output, context read per token written, $ per run that led to a commit), filterable by kind of work. **Output**: your commits, lines changed, pull/merge requests (GitHub via `gh`, GitLab via `glab`), worktrees, and what agent spend each of them cost. **Rhythm**: when you start work, run lengths, agents at once. |

Each panel has an expand button that opens the same mod as a large overlay/window, and remembers its width.

The sidebar's Agents list is replaced by an **Inbox** (`inbox`, after [T3 Inbox](https://github.com/JinJieBeWater/herdr-t3-inbox)):
a card for every agent waiting on you (blocked, finished, or idle for its next prompt) with its program icon,
folder, task and branch. Working agents are one `Working N` row that opens the Agents panel. Hover a card and
**Settle** it (Herdr's `tab.settle`) to put it on the shelf below; Herdr brings it back when its agent needs
you again, and the tab bar hides settled tabs. Spaces above it is sized to its rows.

| Key | Does |
|---|---|
| ⌘⇧J | Next agent that needs you (blocked first, then done), sidebar open or not |
| ⌘⇧O | Every worktree of the repo you're in (Herdr's Open worktree dialog: filter, Enter opens one as a space) |
| ⌘B | Fold the sidebar to a 14px strip that shows only a dot per agent that needs you (click one to go there, the strip to unfold), and back. In `factory`; Herdr's own ⌘B hides it |

Worktrees work best with Herdr's model, one space per repo: then Spaces nests each worktree under its repo,
and right-clicking a repo offers New / Open / Remove worktree.

## Set it up with your coding agent

Paste this to the agent (Claude Code, Codex, pi, …) running in a Herdr terminal:

```text
Install herdr-mods (https://github.com/shoaibkhanz/herdr_mods) into my Herdr app, end to end.

1. Check the prerequisites and stop to tell me what's missing:
   - `herdr-app status` prints JSON (Herdr app 0.1.15 or newer, running).
   - `git`, `python3` and `bash` exist.
   - `gh auth status` says logged in (the PRs panel and Usage's pull requests need it; ask me to run `gh auth login` if not).
   - Optional, just report them: `glab auth status` (GitLab merge requests in Usage) and `zstd --version` (Codex's older
     logs in Usage).
2. Clone it: `git clone https://github.com/shoaibkhanz/herdr_mods ~/code/herdr-mods` (or pull if it's there).
3. Run `~/code/herdr-mods/install.sh`. It links every mod and layout into ~/.config/herdr-app
   (or $HERDR_APP_HOME), adds key bindings and omp's program icon without replacing anything I
   already have, checks each mod with `herdr-app check`, and switches Herdr to the `factory` layout.
4. Verify:
   - `herdr-app status` shows "layout": "factory" and "errors": [].
   - `python3 ~/code/herdr-mods/mods/usage/scan.py | head -c 300` prints JSON starting `{"scanned_at":` (the first run
     reads every harness log on this machine and can take a minute; later runs only read what changed).
   - `herdr-app do tabs-plus.graph`, then `tabs-plus.prs`, `tabs-plus.skills` and `tabs-plus.usage` each show a panel;
     take `herdr-app shot /tmp/herdr-mods.png` after each and look at it. Run the last one again to hide it.
   - The sidebar shows Spaces and an Inbox; `herdr-app do tabs-plus.rail` folds it to a thin strip and back.
5. Report any `skip` line install.sh printed: something with that name already existed and was left alone.

Never edit or delete files in ~/.config/herdr-app that install.sh did not create.
```

## Install by hand

```sh
git clone https://github.com/shoaibkhanz/herdr_mods ~/code/herdr-mods
~/code/herdr-mods/install.sh
```

Safe to rerun. What it does:

- Links `mods/*` and `layouts/*.json` into `~/.config/herdr-app/` (pull or edit in the clone; see Develop for reloading).
  A mod or layout of the same name that isn't a link to this clone is left alone (`skip`).
- Merges `keys.json` (⌘⇧G / ⌘⇧U / ⌘⇧K toggle the panels, plus ⌘⇧J, ⌘⇧O and ⌘B above) and `programs.json`
  (omp's own icon, `mods/inbox/omp.svg`, instead of the generic agent one). Keys and entries you already have are kept (`skip`).
- Runs `herdr-app check` on every mod and switches to the `factory` layout. `ctrl-shift-l` cycles back to
  Herdr's own layouts.

To undo: `herdr-app do layout.switch --name main`, delete the links
(`find ~/.config/herdr-app/mods ~/.config/herdr-app/layouts -maxdepth 1 -lname "$HOME/code/herdr-mods/*" -delete`),
and remove the `tabs-plus.*` keys from `~/.config/herdr-app/keys.json` and the `omp` entry from `programs.json`.

## What's in here

- `mods/agent-graph`, `mods/pr-review`, `mods/skills`: the three panels.
- `mods/inbox`: the sidebar's Inbox, in place of Herdr's Agents list.
- `mods/spaces-plus`: Herdr's Spaces list (0.1.15) with soft avatars (the space's colour as a light tile, its letter in the colour).
- `mods/tabs-plus`: Herdr's tab bar (0.1.15) with the Agents / PRs / Library buttons; hides settled tabs.
- `layouts/factory.json`: Herdr's `main` layout (0.1.15) with the three panels in the side panel stack and the Inbox in the sidebar.
  Herdr updates to its own `tabs` mod and `main` layout don't flow into these copies.
- `mods/nav-keys` (optional): ctrl-h/j/k/l moves between panes, and hands the key to (n)vim when it's focused
  so an editor mapping can move between splits first. `factory` hosts it in a 0px block; it only does
  something once you bind the keys, in `~/.config/herdr-app/keys.json`:

  ```json
  "terminal": { "ctrl-h": "nav-keys.left", "ctrl-j": "nav-keys.down", "ctrl-k": "nav-keys.up", "ctrl-l": "nav-keys.right" }
  ```

  Those keys then no longer reach your shell (ctrl-l clear, ctrl-k kill line), which is why it's opt-in.
  In (n)vim the key goes to the editor: map ctrl-h/j/k/l there to move between splits and call
  `herdr-app do pane.go --direction <dir>` at the edge, or bind only outside vim.

## Requirements

- Herdr app ≥ 0.1.15 (built and tested on macOS).
- `git`; `gh` signed in for the PRs panel (and `glab` for GitLab merge requests in Usage); `python3` and `bash` for `install.sh` and the Usage panel's scanners.
- Fonts: Geist and Geist Mono, which ship with Herdr.
- Optional: Claude Code plugins (`~/.claude/plugins`) for the Library's Plugins tab.

## Develop

```sh
herdr-app check ~/.config/herdr-app/mods/<name>   # loads and renders once
(cd mods/<name> && bun test)                      # pure logic tests
herdr-app shot /tmp/shot.png                      # screenshot the live window
```

Panel copies and floating windows don't pick up edits in place: switch layouts
(`herdr-app do layout.switch --name main`, then `--name factory`) to restart them.
Platform gotchas worth knowing before you change anything (for people and agents): [`docs/platform-notes.md`](docs/platform-notes.md).

Design: [`docs/specs/2026-11-11-herdr-mods-design.md`](docs/specs/2026-11-11-herdr-mods-design.md).

License: MIT (see [`LICENSE`](LICENSE)); icons from [Lucide](https://lucide.dev) (ISC); the omp icon is omp's own (MIT).
