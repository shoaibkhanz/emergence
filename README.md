# herdr-mods

Native mods for the [Herdr app](https://herdr.dev), built for running many coding agents at once.

> Sample edit for the pr-review test PR.

| Mod | Key | What it shows |
|---|---|---|
| `agent-graph` | ⌘⇧G | Every agent on a canvas: repo → worktree/branch (with its PR) → agent → sub-agents. Click an agent to jump to it, a PR chip to review it. |
| `pr-review` | ⌘⇧U | Floating window that follows the focused pane's repo: PRs (open/closed, search), the branch vs main, the diff, GitHub line comments (multi-line, reply, edit, delete, resolve). |
| `skills` | ⌘⇧K | Palette of every skill across `~/.agents`, `~/.claude`, OpenCode, Codex and the current repo. Pop a skill out into its own window: SKILL.md, references, scripts. |

## Install

```sh
./install.sh
```

Links each `mods/<name>` into `~/.config/herdr-app/mods/` (edits here hot-reload in the app)
and adds the key bindings from `keys.json` without replacing keys you already use.

Needs: Herdr app ≥ 0.1.15, `git`, and `gh` signed in for PR data.

## Develop

```sh
herdr-app check ~/.config/herdr-app/mods/<name>   # loads and renders once
(cd mods/<name> && bun test)                      # pure logic tests
herdr-app shot /tmp/shot.png                      # screenshot the live window
```

Design: [`docs/specs/2026-11-11-herdr-mods-design.md`](docs/specs/2026-11-11-herdr-mods-design.md).
