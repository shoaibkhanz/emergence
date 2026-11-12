# Emergence

A layout for the [Herdr app](https://herdr.dev) for running many coding agents at once: every agent as a graph, a
pull request reviewer, a skills and plugins library, usage analytics across harnesses, and an inbox for the agents
that need you.

![Emergence](preview.png)

## Install

Tell your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/shoaibkhanz/emergence

Or run one command (run it again to update):

```sh
curl -fsSL https://raw.githubusercontent.com/shoaibkhanz/emergence/main/install.sh | bash
```

It clones this repo to `~/code/emergence`, links every mod into Herdr, adds the keys below without replacing any you
have, and switches to the `emergence` layout (`ctrl-shift-l` cycles back to Herdr's own).

Needs Herdr 0.1.15 or newer, `git` and `python3`; `gh` signed in for pull requests, `glab` for GitLab merge requests.
The fonts (Geist, Geist Mono) ship with Herdr.

## What you get

**Panels**, as buttons in the tab bar (each opens large from its corner button):

| Panel | Key | |
|---|---|---|
| Agents | ⌘⇧G | Every agent as a graph: repo → worktree (with its PR) → agent → sub-agents. Click an agent to jump to it, a PR to review it, a repo for its worktrees. Drag cards; the wheel zooms. |
| PRs | ⌘⇧U | The repo you're in: its PRs and this branch vs main. Changed files as a tree, one diff at a time. Select lines, then comment, tagged Statement · Question · Nit · Minor · Major. Reply, edit, delete, resolve. |
| Library | ⌘⇧K | Every agent skill on this machine and in the repo, and your installed Claude Code plugins with the skills they ship. Opens one in a reusable window. |
| Usage | ⌘⇧M | How you work across omp, Claude Code, Codex, OpenCode and pi, from their logs and your git history on this machine. See below. |

**Sidebar**

- **Inbox** (after [T3 Inbox](https://github.com/JinJieBeWater/herdr-t3-inbox)): a card for every agent waiting on you
  (blocked, finished, or idle for its next prompt). Working agents fold into one row that opens the graph. Settle puts
  a card away until its agent needs you again.
- **Spaces**: soft avatars, sized to their rows.
- **⌘B** folds it to a thin strip: one coloured line per agent that needs you, nothing else.

**Keys**: ⌘⇧J jumps to the next agent that needs you. ⌘⇧O lists every worktree of the repo you're in.

## Usage, in detail

Pick 7, 30 or 90 days, a year, or two dates (both included). Nothing leaves your machine.

- **Overview**: sessions, active days, tokens, cost; a year calendar; where the tokens go (fresh input, cache, output);
  what the work was (build, investigate, run and debug, research, orchestrate).
- **Compare**: for each harness and model, the share of runs that went cleanly (with its 95% range), what one clean
  run costs, and how many tool calls it takes; a success-against-cost chart; the cost anatomy ($ per 1M tokens, per 1K
  output tokens, per run that led to a commit). Filter by kind of work, or to repos you used several harnesses in.
- **Output**: your commits, lines changed, pull and merge requests, worktrees, and what the agent spend came to per
  commit, per merged PR and per 1K lines.
- **Harnesses**: tokens over time, the models you use, and effort levels.
- **Rhythm**: when you start work, how many agents run at once, how long runs last.

Cost is what each harness recorded, at API prices (Codex records none). The kind of work is read from each run's mix of
tools, never from your prompts.

## What it runs

- **Agents**: `git rev-parse` in each agent's folder, and `gh pr list` once a minute per repo.
- **PRs**: `git` and `gh` in the focused repo; posting a comment, reply, edit, delete or resolve calls the GitHub API.
- **Library**: lists skill folders under `~/.agents`, `~/.claude`, `~/.config/opencode`, `~/.codex` and the repo, and
  reads `~/.claude/plugins/installed_plugins.json`.
- **Usage**: `python3 mods/usage/scan.py` reads the harnesses' session logs (omp, Claude Code, Codex, OpenCode, pi) and
  keeps a cache in Herdr's `data/usage/`; `python3 mods/usage/output.py` runs `git log`, `gh pr list` or `glab mr list`
  and `git worktree list` in the repos those sessions name. Only counts, models and timestamps are read, never prompts.
- **Inbox, Spaces, tab bar**: nothing outside Herdr.

## Update or remove

Update: run the install command again, then `herdr-app do layout.switch --name main` and `--name emergence` to reload.

Remove: switch back with `herdr-app do layout.switch --name main`, delete the links
(`find ~/.config/herdr-app/mods ~/.config/herdr-app/layouts -maxdepth 1 -lname "$HOME/code/emergence/*" -delete`),
then take the `tabs-plus.*` keys out of `~/.config/herdr-app/keys.json` and the `omp` entry out of `programs.json`.

## Optional: ctrl-h/j/k/l between panes

`nav-keys` moves between panes, and hands the key to (n)vim when it's focused. It does nothing until you bind it in
`~/.config/herdr-app/keys.json`, because the keys then stop reaching your shell (ctrl-l clear, ctrl-k kill line):

```json
"terminal": { "ctrl-h": "nav-keys.left", "ctrl-j": "nav-keys.down", "ctrl-k": "nav-keys.up", "ctrl-l": "nav-keys.right" }
```

## Develop

| Path | What |
|---|---|
| `mods/agent-graph`, `pr-review`, `skills`, `usage` | the four panels |
| `mods/inbox`, `spaces-plus` | the sidebar |
| `mods/tabs-plus` | Herdr's tab bar with the panel buttons |
| `layouts/emergence.json` | Herdr's `main` layout with all of the above |
| `RECIPE.md` | the brief to rebuild it from scratch |

`spaces-plus`, `tabs-plus` and the layout are copies of Herdr 0.1.15's own; Herdr updates don't flow into them.

```sh
herdr-app check ~/.config/herdr-app/mods/<name>   # loads and renders once
(cd mods/<name> && bun test)                      # logic tests; Usage also: python3 mods/usage/test_scan.py
```

Edits don't reach open panels: switch layouts (`main`, then `emergence`) to restart them. Read
[`docs/platform-notes.md`](docs/platform-notes.md) before changing anything.

MIT licensed (see [`LICENSE`](LICENSE)). Icons from [Lucide](https://lucide.dev) (ISC); omp's icon is its own (MIT).
