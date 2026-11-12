# Emergence

A layout for the [Herdr app](https://herdr.dev) for running many coding agents at once: every agent as a graph, a
pull request reviewer, a skills and plugins library, usage analytics across harnesses, and an inbox for the agents
that need you.

![Emergence](preview.png)

## Install

Tell your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this layout by running its install.sh: https://github.com/shoaibkhanz/emergence

Or run one command yourself:

```sh
curl -fsSL https://raw.githubusercontent.com/shoaibkhanz/emergence/main/install.sh | bash
```

It clones this repo to `~/code/emergence`, links every mod into Herdr, adds the keys below without replacing any you
have, and switches to the `emergence` layout (`ctrl-shift-l` cycles back to Herdr's own). When this repo changes, an
**Update** chip appears in the tab bar; click it to pull and relink.

Needs Herdr 0.1.15 or newer, `git` and `python3`; `gh` signed in for pull requests, `glab` for GitLab merge requests.
The fonts (Geist, Geist Mono) ship with Herdr.

## What you get

Four panels open from buttons in the tab bar (each also opens large from its corner button), and the sidebar becomes
an inbox. Every screenshot below uses made-up data.

### Agents (⌘⇧G): who's running, where, and who needs you

![Agents panel: repos, worktrees with their PRs, and agents](docs/images/agents.png)

Every agent on the machine in one picture: repo → worktree, with the PR it has open → agent → its sub-agents. With a
dozen agents running, the one that's blocked shows in red and the finished one in green, so you see where to look
without visiting each tab. Click an agent to jump to it, a PR to review it, a repo to list its worktrees. Drag cards
around; the wheel zooms.

### PRs (⌘⇧U): review your agents' work without leaving Herdr

![PRs panel: a pull request's files, diff and tagged review threads](docs/images/prs.png)

The PRs of the repo you're in, plus this branch against main. Changed files form a tree, with one diff at a time and
review threads inline. Select lines and comment, tagged Statement · Question · Nit · Minor · Major. The tag posts as a
coloured badge on GitHub, so whoever picks up the review (you, or the agent) can tell a nit from a blocker at a glance.
Reply, edit, delete and resolve threads here too. For more room, hide the PR list beside an open PR, widen the panel,
or open the review in its own window and drag its edge or corner to any size.

### Library (⌘⇧K): every skill your agents can load

![Library panel: skills from every harness folder, with where each lives](docs/images/library.png)

Skills from `~/.agents`, `~/.claude`, `~/.codex`, `~/.config/opencode` and the repo, plus your installed Claude Code
plugins and the skills they ship. It's one searchable list that shows where each skill lives, so you can check what's
already installed before writing or copying another. Each skill opens in a reusable window.

### Usage (⌘⇧M): what your agents cost, and what they deliver

How you work across omp, Claude Code, Codex, OpenCode and pi, read from their own logs and your git history. Pick 7,
30 or 90 days, a year, or two dates. Nothing leaves your machine.

<table>
<tr>
<td width="50%"><img src="docs/images/usage-overview.png" alt="Usage overview"></td>
<td width="50%"><img src="docs/images/usage-compare.png" alt="Usage compare"></td>
</tr>
<tr>
<td valign="top"><b>Overview.</b> Sessions, active days, tokens and spend, against the period before. A calendar shows
every day, and the breakdowns show where tokens go (fresh input, cache writes, cache reads, output) and what kind of
work it was. Agents re-read their context on every step, so the cache share tells you whether long runs are cheap or
expensive.</td>
<td valign="top"><b>Compare.</b> For each harness and model: the share of runs that went cleanly (no abort, API error
or compaction, few failed tools) with its 95% range, what one clean run costs, tool calls per run, and how often a run
led to a commit. A winner is only named when the ranges don't overlap, so you switch tools on evidence.</td>
</tr>
<tr>
<td width="50%"><img src="docs/images/usage-harnesses.png" alt="Usage harnesses"></td>
<td width="50%"><img src="docs/images/usage-output.png" alt="Usage output"></td>
</tr>
<tr>
<td valign="top"><b>Harnesses.</b> Tokens by harness over time, the models that carry the load, and the effort level each
harness runs at. A move from one harness or model to another shows up week by week.</td>
<td valign="top"><b>Output.</b> What the spend produced: commits, lines changed, pull and merge requests, worktrees. Then
what that delivery cost, per commit, per merged PR and per 1K lines.</td>
</tr>
<tr>
<td width="50%"><img src="docs/images/usage-rhythm.png" alt="Usage rhythm"></td>
<td valign="top"><b>Rhythm.</b> When you start work, how many agents run at once on each day, and how long runs last.
Find the hours you run the most agents, and the runs that drag on.<br><br>
Hover any bar or square for its numbers. Press or drag across days, bars or hours (say 09:00–12:00) and every other
number follows; ✕ shows the whole period again. Cost is what each harness recorded, at API prices (Codex records none). The
kind of work comes from each run's mix of tool calls, never from your prompts.</td>
</tr>
</table>

**Usage only sees what's on this machine.** It reads the session logs each harness keeps locally and the git repos
those sessions ran in. Work done on another computer isn't counted, and neither is history a harness already deleted.
Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays` in `~/.claude/settings.json`), so a first
scan sees about a month of Claude Code. From then on, Usage keeps every session it has read, even after Claude Code
prunes it. Raise `cleanupPeriodDays` to keep more.

### Sidebar

- **Inbox** (after [T3 Inbox](https://github.com/JinJieBeWater/herdr-t3-inbox)): a card for every agent waiting on you
  (blocked, finished, or idle for its next prompt). Working agents fold into one row that opens the graph. Settle puts
  a card away until its agent needs you again.
- **Spaces**: soft avatars, sized to their rows.
- **⌘B** folds it to a thin strip: one coloured line per agent that needs you, nothing else.

**Keys**: ⌘⇧J jumps to the next agent that needs you. ⌘⇧O lists every worktree of the repo you're in.

## What it runs

- **Agents**: `git rev-parse` in each agent's folder, and `gh pr list` once a minute per repo.
- **PRs**: `git` and `gh` in the focused repo; posting a comment, reply, edit, delete or resolve calls the GitHub API.
- **Library**: lists skill folders under `~/.agents`, `~/.claude`, `~/.config/opencode`, `~/.codex` and the repo, and
  reads `~/.claude/plugins/installed_plugins.json`.
- **Usage**: `python3 mods/usage/scan.py` reads the harnesses' session logs (omp, Claude Code, Codex, OpenCode, pi) and
  keeps a cache in Herdr's `data/usage/`; `python3 mods/usage/output.py` runs `git log`, `gh pr list` or `glab mr list`
  and `git worktree list` in the repos those sessions name. Only counts, models and timestamps are read, never prompts.
- **Tab bar**: every 6 hours, `git fetch` of this repo's `main` (public HTTPS) into your clone; **Update** runs
  `git merge --ff-only` and `install.sh` there. Nothing for a copy that isn't a clone of this repo, or one on another
  branch or with your own commits.
- **Inbox, Spaces**: nothing outside Herdr.

## Update or remove

Update: click **Update** in the tab bar when it shows (it checks every 6 hours), or run the install command again.
If you installed by copying the files, run the install command once to switch to a clone.

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
