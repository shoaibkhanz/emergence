# herdr-mods

Native mods for the [Herdr app](https://herdr.dev) for running many coding agents at once.
They live as side panels in the tab bar, next to Herdr's Files and Changes.

| Panel | Key | What it shows |
|---|---|---|
| Agents (`agent-graph`) | ⌘⇧G | Every agent on a canvas: repo → worktree/branch (with its PR) → agent → sub-agents. Click an agent to jump to it, a PR chip to review it. Drag a card to move it, empty space to pan; R resets the arrangement. |
| PRs (`pr-review`) | ⌘⇧U | Follows the focused pane's repo: PRs (open/closed, search), the branch vs main, the diff, GitHub line comments (multi-line, reply, edit, delete, resolve). |
| Library (`skills`) | ⌘⇧K | Skills: every skill across `~/.agents`, `~/.claude`, OpenCode, Codex and the current repo. Plugins: installed Claude Code plugins and the skills they ship. Open one in the skill window: SKILL.md, references, scripts (one window, reused). |

Each panel has an expand button that opens the same mod as a large overlay/window.
Panels remember their own width.

## Install

```sh
./install.sh
```

Links `mods/*` and `layouts/*` into `~/.config/herdr-app/` (edits here hot-reload in the app),
adds the key bindings from `keys.json` without replacing keys you already use, and switches to
the `factory` layout. `ctrl-shift-l` cycles back to Herdr's own layouts.

- `layouts/factory.json`: Herdr's `main` layout (0.1.15) with three more blocks in the side panel, plus a
  0px block hosting `nav-keys` (ctrl-hjkl, from the dotfiles) so it needs no floating window: an invisible
  window there once sat over the panel column and swallowed every click.
- `mods/tabs-plus`: Herdr's tab bar (0.1.15) with the extra panel buttons. Herdr updates to its
  own `tabs` mod and `main` layout don't flow into these copies.

Needs: Herdr app ≥ 0.1.15, `git`, and `gh` signed in for PR data.

## Develop

```sh
herdr-app check ~/.config/herdr-app/mods/<name>   # loads and renders once
(cd mods/<name> && bun test)                      # pure logic tests
herdr-app shot /tmp/shot.png                      # screenshot the live window
```

Floating windows don't hot-reload: close and reopen them after a change.

Design: [`docs/specs/2026-11-11-herdr-mods-design.md`](docs/specs/2026-11-11-herdr-mods-design.md).
