# herdr-mods

Native mods for the [Herdr app](https://herdr.dev) for running many coding agents at once.
They live as side panels in the tab bar, next to Herdr's Files and Changes.

| Panel | Key | What it shows |
|---|---|---|
| Agents (`agent-graph`) | ⌘⇧G | Every agent on a canvas: repo → worktree/branch (with its PR) → agent → sub-agents. Click an agent to jump to it, a PR chip to review it. Drag a card to move it, empty space to pan; R resets the arrangement. |
| PRs (`pr-review`) | ⌘⇧U | Follows the focused pane's repo: PRs (open/closed, search) and the branch vs main. The changed files as a folder tree with +/− and comment counts; one file's diff at a time (↑/↓ step files). Select lines (click, shift-click, drag), then comment from the box docked under the diff, tagged Statement · Question · Nit · Minor · Major (posted as a shields.io badge). Reply, edit, delete, resolve. |
| Library (`skills`) | ⌘⇧K | Skills: every skill across `~/.agents`, `~/.claude`, OpenCode, Codex and the current repo. Plugins: installed Claude Code plugins and the skills they ship. Open one in the skill window: SKILL.md, references, scripts (one window, reused; the corner button makes it bigger). |

Each panel has an expand button that opens the same mod as a large overlay/window, and remembers its width.
⌘⇧J jumps to the next agent that needs you (blocked ones first, then done), from anywhere, sidebar open or not.

## Set it up with your coding agent

Paste this to the agent (Claude Code, Codex, pi, …) running in a Herdr terminal:

```text
Install herdr-mods (https://github.com/shoaibkhanz/herdr_mods) into my Herdr app, end to end.

1. Check the prerequisites and stop to tell me what's missing:
   - `herdr-app status` prints JSON (Herdr app 0.1.15 or newer, running).
   - `git`, `python3` and `bash` exist.
   - `gh auth status` says logged in (the PRs panel needs it; ask me to run `gh auth login` if not).
2. Clone it: `git clone https://github.com/shoaibkhanz/herdr_mods ~/code/herdr-mods` (or pull if it's there).
3. Run `~/code/herdr-mods/install.sh`. It links every mod and layout into ~/.config/herdr-app
   (or $HERDR_APP_HOME), adds four key bindings without replacing any I already have, checks
   each mod with `herdr-app check`, and switches Herdr to the `factory` layout.
4. Verify:
   - `herdr-app status` shows "layout": "factory" and "errors": [].
   - `herdr-app do tabs-plus.graph`, then `tabs-plus.prs`, then `tabs-plus.skills` each show a panel;
     take `herdr-app shot /tmp/herdr-mods.png` after each and look at it. Run the last one again to hide it.
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
- Merges `keys.json`: ⌘⇧G / ⌘⇧U / ⌘⇧K toggle the panels, ⌘⇧J jumps to the next agent that needs you.
  Keys you already bound are kept (`skip`).
- Runs `herdr-app check` on every mod and switches to the `factory` layout. `ctrl-shift-l` cycles back to
  Herdr's own layouts.

To undo: `herdr-app do layout.switch --name main`, delete the links
(`find ~/.config/herdr-app/mods ~/.config/herdr-app/layouts -maxdepth 1 -lname "$HOME/code/herdr-mods/*" -delete`),
and remove the four `tabs-plus.*` keys from `~/.config/herdr-app/keys.json`.

## What's in here

- `mods/agent-graph`, `mods/pr-review`, `mods/skills`: the three panels.
- `mods/tabs-plus`: Herdr's tab bar (0.1.15) with the Agents / PRs / Library buttons.
- `layouts/factory.json`: Herdr's `main` layout (0.1.15) with the three panels in the side panel stack.
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
- `git`; `gh` signed in for the PRs panel; `python3` and `bash` for `install.sh`.
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

License: MIT (see [`LICENSE`](LICENSE)); icons from [Lucide](https://lucide.dev) (ISC).
