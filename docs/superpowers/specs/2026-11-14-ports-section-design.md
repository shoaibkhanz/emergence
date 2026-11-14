# Ports in the sidebar, system load in the status bar

## Why

Agents start dev servers, previews and test APIs. The port is then easy to lose track of, and a server can outlive the
agent that started it. Agents also load the machine (test runs, builds, watchers) and fill the disk (a `node_modules`
per worktree), with nothing in Herdr showing which agent is responsible. Emergence should show both, in the same quiet
style as the rest of the layout, and always answer "which agent?".

Two parts, built in this order: **1. Ports** (sidebar section + port card), **2. System** (status bar numbers +
popup). They share the process→agent link and the popup style.

## Goals, non-goals, anti-goals

- Goals: every dev server and its agent at a glance; open it; stop a forgotten one. CPU, memory and disk always
  visible; one click to see which agent and which process is using them.
- Non-goals: other machines (local only: `lsof`/`ps` run here, a remote space's servers aren't shown); UDP; restarting
  servers; stopping one port of a multi-port process; killing processes from the System popup; temperature, load
  averages, network; Docker container names.
- Anti-goals: system-service noise (rapportd, Control Center, Logi, Homebrew services) in Ports; anything animated or
  redrawn when nothing changed (AGENTS.md: a spinner costs battery); a destructive control one stray click from use;
  a new visual language. Every part reuses an existing Emergence pattern, named below.

## Approaches considered

Where Ports goes:
- **A. Own sidebar section** (picked by the person): one place for every port, and the only option that shows
  orphaned servers.
- B. Tags on Spaces worktree rows: no new space, but orphans have no row, and two ports crowd the branch.
- C. One-line footer that opens a list: cheap, but you can't see which port until you click.

Where CPU / memory / disk go: the status bar's right side, before the commands hint (picked by the person), with a
popup. Not a sidebar section: height is already shared by Spaces, Inbox and Ports.

Who owns a server whose parent chain no longer reaches a terminal (`&`, `nohup`, a detached script, the launching
shell gone): **folder match** (picked by the person) over process-link-only, which would call a live agent's server
"forgotten".

## The shared piece: which agent owns a process

- Every 5 s, one `ps -axo pid=,ppid=,rss=,etime=,time=,comm=` (35 ms here). `comm` is last because on macOS it is a
  full path with spaces; the full command line (`ps -p <pid> -o args=`) is read only for the port card.
- Terminals: Herdr's `terminals()` if it carries the terminal's `pid` and `foreground.pid`, else `hc get <t>` per live
  terminal (it has both; 7 ms each; verified). The builder checks which first. Re-read every poll: a kept terminal
  whose program died gets a new shell and a new pid.
- **Only this computer's terminals.** A terminal on another machine has a pid from that machine, which can equal a
  local pid and would claim a stranger's process.
- **Owner, step 1 (sure)**: walk the process's parent chain; the first terminal pid it meets owns it.
- **Owner, step 2 (probable)**: no terminal on the chain, and the process's folder (`lsof -d cwd`) is inside an open
  agent pane's git worktree root: that agent, marked *probable*. The deepest matching root wins (a worktree nested in
  its repo's main checkout beats the checkout); a tie goes to the agent whose tab changed most recently.
  - Never match a root that is the home folder or `/` (a dotfiles repo at `~`, an agent started in `~`): it would claim
    every orphan on the machine. An agent in a folder that isn't a repo matches only that exact folder.
  - Claude Code's scratchpad: a folder under `<tmp>/claude-<uid>/<slug>/` belongs to the agent whose folder slugs to
    `<slug>` (every non-alphanumeric character → `-`; path → slug is exact, so no guessing back). This is the orphan
    seen on this machine: a Python server started from a scratchpad. Only Ports listeners need step 2 (their folders come
  from the same `lsof` call); System uses step 1 alone, and lists step-2-free processes under "Not in an agent".
- **Orphan**: neither step finds an owner.
- Describing an owner: the agent's program mark and task, its pane's branch (else folder).
  - Plain shell terminal (no agent): owned by that terminal; the shell's mark and its branch; "Go to terminal".
  - Sub-agent: Ports shows the sub-agent's mark and "Go to agent" peeks at it (`terminal.peek`, as Inbox does);
    System rolls it into its top-level agent's row.
- **Agent's own process** (the agent terminal's foreground process, e.g. Claude Code): its listening ports are hidden
  from Ports; its CPU and memory count for it in System.
- Known limit: a tool the agent itself starts that listens (an MCP server with an HTTP port, a browser bridge) is a
  child of the agent like any dev server, and shows as one. Nothing in the process table tells them apart.
- Each part polls on its own: `setShared` writes to disk and re-renders every mod, not a channel for process tables.
- A poll never overlaps the last one (skip while one is in flight) and every `exec` has a timeout (4 s); a slow or
  hung `lsof` costs one missed refresh, never a pile of processes.
- Polling pauses while its view can't be seen (Ports folded away; the System popup closed stops its extra reads).
- Pure functions in `lib.js` (parse `ps`, parse `lsof`, parent chain, attribute, sums), unit-tested with recorded
  output as the other mods' `lib.test.js`.

## Part 1: Ports

### The section

A `ports` block in the layout's `sidebar-lists` column after `inbox`, mod `ports` (`focusable: true`). It sizes
itself with `layout.resize` to header + rows, at most 5 rows (then the list scrolls).

```
 Ports  3                                   header: 11.5px dim, as "Inbox 3"
 [◆] :5173   vite        feat/rate-limit…   ◆ the owner's program mark, 14px
 [◇] :8000   uvicorn     fix/timeout-retry  ◇ the mark at 50%: probable owner
 [○] :18791  python      no agent · 2h      ○ hollow 14px ring, dim
```

- Empty: one 32px row, "Ports" and a dim "none", no header, no list. It costs as much as "Working 0".
- Row: the Inbox's Settled-shelf row (30px, radius 8, `hover` background): mark, port in Geist Mono 12.5
  `foreground`, process name 12 `muted`, owner on the right in Geist Mono 11.5 `dim`, truncated.
- Sorted: owned (sure and probable) first, by port; orphans after, oldest first.
- Orphans read `no agent · <age>`; past 1 hour the age turns `working` amber (forgotten).
- Bound to every interface (`*`, `0.0.0.0`, `::`): a 12px Lucide `globe` in `dim` before the owner. Dim, not amber:
  `--host` is routine for dev servers, and amber everywhere would teach you to ignore amber.
- Hover swaps the owner for one 18px chip, **Open** (as Inbox swaps the age for Settle), only for web servers. No Stop
  on hover: a destructive control doesn't belong where the pointer passes on the way to a click.
- Click a row: the **port card**. ↵: the card. ←: the card, already asking "Stop?" (Cancel selected).
- Keyboard: ↑ ↓ move, ↵ card, ← stop, ctrl-k to Inbox, ctrl-l / Esc back to the terminal; Inbox gains ctrl-j → Ports.
  `mod:ports` section in `keys.json`; the cursor draws the accent ring as Inbox's does.
- ctrl-j from Inbox with no ports: nothing happens (the keyboard stays in Inbox).
- Folded sidebar (rail, dots): the block resizes itself to 0px (left at its height, it would push Inbox's badge up
  from the foot) and stops polling. A 0px block stays alive (nav-keys lives in one).
- Height is a function of the row count only, never of a measured size, so it can't chase Inbox's `fitSpaces` in a
  resize loop. The layout block's `max` keeps Inbox at its 90px minimum on a short window; the list scrolls.

### Data

- `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` every 5 s (35 ms here) → pid, command, bind address, port.
  `lsof -a -p <pids> -d cwd -Fpn` for the listeners' folders.
- **One row per server, not per socket.**
  - The same pid on IPv4 and IPv6: one row.
  - Several pids holding the same port in one process tree (a forked socket: `uvicorn --reload`, gunicorn workers):
    one row, for the topmost holder (the supervisor). Stop targets it; killing a worker only makes the supervisor
    start another.
  - The same port number held by unrelated processes (one on `127.0.0.1:3000`, another on `[::1]:3000`): two rows.
- **The URL is the address the server is actually on**: `localhost` when it listens on both families or every
  interface, `127.0.0.1` when IPv4 only, `[::1]` when IPv6 only, the IP itself when bound to one (a LAN or Tailscale
  address). `localhost` alone can open a different server than the row you clicked.
- **Web or not, without touching the port.** Ports never sends a request of its own: a one-shot listener (the OAuth
  callback of `gh auth login`, `gcloud auth login`, an MCP sign-in) can take the first request it gets as its answer
  and exit, and a probe would break the login. Not web = a short table of well-known ports and process names
  (5432 postgres, 3306 mysqld, 6379 redis-server, 27017 mongod, 9229 node inspector, …): no Open chip, and the card
  shows the address in a copyable box instead of Open. Everything else offers Open. `ponytail:` the table is the
  ceiling; a probe on the person's own click is the upgrade.
- Shown: everything an agent or shell terminal owns (sure or probable), except the agent's own port; and orphans whose
  folder is under home or a temp folder and that aren't an agent binary (claude, codex, omp, pi, opencode). Docker
  Desktop / OrbStack listeners (`com.docker.*`, `vpnkit`, `OrbStack`) show as owner "docker", never amber, no Go to
  and **no Stop** (the pid is Docker itself: stopping it would take down every container).
  Heuristic; `ponytail:` comment naming the ceiling (container names via `docker ps` if wanted).
- Re-render only when the list changes.

### The port card

A popup (`openOverlay` kind `popup`, at the pointer; from the keyboard, beside the row), 340px wide, confirm-safe's
dialog grammar: `popover` background, 20px padding, 14px gaps, radius 10, "Esc" top right in `dim`.

```
┌──────────────────────────────────────────┐
│ :5173  vite                          Esc │  15px semibold; port mono
│ ┌──────────────────────────────────────┐ │
│ │ http://localhost:5173            [⧉] │ │  mono box (surface, border); copy
│ └──────────────────────────────────────┘ │
│ Agent    [◆] Claude Code · working       │  labels 11.5 dim, 64px column
│          Add Prometheus counters          │  task, 12 muted
│ Branch   feat/rate-limit-metrics         │  mono
│ Command  npm run dev -- --port 5173      │  mono; 2 lines, then truncated
│ Running  42m · 3% CPU · 312 MB           │  one line, mono numbers
│ Reach    This Mac only                   │  or [globe] Your network
│ Also     :24678                          │  other ports of the process, if any
│                                          │
│   [ Go to agent ]   [ Stop ]  [ Open ↵ ] │  32px buttons as confirm-safe's
└──────────────────────────────────────────┘
```

- Probable owner: the Agent line reads `[◇] Claude Code · probably` and the button `Go to agent?`.
- Orphan: Agent reads `no agent`, Go to is hidden. Docker: Agent reads `Docker`.
- **Folder** line only when the process's folder isn't the branch's worktree root (a scratchpad, a subfolder).
- **pid** shows in the Stop question and in a tooltip on Running, not as its own line.
- The card is its own mod, opened with the row as props, which don't change. It reads its one process itself every
  5 s (`ps -p <pid>`), so its numbers are live. If the process is gone: "Stopped" in place of Running, Open and Stop
  disabled. It never offers to open a dead port.
- Open (`cx.open_url`) is the primary: accent tint and `↵`, as the Library's Open. Stop is `blocked`-tinted, Go to
  plain (`agent.focus` + `pane.focus`, as an Inbox card).
- Keys: ↵ Open, ← → move between buttons, Esc closes. Esc or a click outside gives the keyboard back to Ports if it
  came from there (`emergence.over`, Inbox's `comeBack` copied). Open and Go to close the card with `went: true`:
  they take you somewhere, so the keyboard isn't pulled back.
- **Stop, one path, inside the card.** The button row becomes the question: "Stop vite (pid 8035)? Closes :5173,
  :24678." with `[ Cancel ] [ Stop ]`, Cancel selected (confirm-safe's rule: Enter alone cancels). On Stop the card
  re-reads `lsof -a -p <pid> -iTCP:<port> -sTCP:LISTEN`; if that pid no longer holds that port (it exited, or the pid
  was reused) it says "already stopped" and kills nothing. Then `exec("kill", [pid])` (SIGTERM). Still listening
  10 s later: a notice says so (a watcher such as nodemon, or the agent, may have started it again). No SIGKILL.
  - Why not confirm-safe plus a `ports.stop` command: a mod command carries no arguments (`nextCommand()` returns a
    name), and commands only reach mods that are shown, so Stop from the System popup with the sidebar folded would
    do nothing, silently. The card kills; no command exists, so nothing outside Herdr's UI can ask for a kill either.
- From the keyboard the card opens at `at: {x, y}` beside the row (sidebar width, row index); from a click, at the
  pointer.

## Part 2: System

### The status bar

Copy Herdr's `workspace-status` into the repo as `status-plus` (as spaces-plus and tabs-plus are copies) and point the
layout's `status` block at it. Left side unchanged. Right side, before the commands hint:

```
 ⌂ This computer  ⑂ main  • 2 agents             [cpu] 34%   [mem] 21/36 GB   [disk] 412 GB   ⌘⇧P commands
```

- Lucide icons 13px (`cpu`, `memory-stick`, `hard-drive`, `battery-low`/`battery-medium`), numbers in Geist Mono 11.8
  with tabular digits so they don't jitter, 16px gaps as the bar's. Disk shows free space (the number you act on).
  Each is a hover target (6px radius, `hover` background) that opens the popup on its tab.
- Colour: `muted`. CPU ≥ 80% over 10 s, memory pressure warn, disk < 10% free, battery < 20%: icon and number
  `working`. Pressure critical, disk < 5%, battery < 10%: `blocked`. Never a filled background. Memory's colour
  follows pressure, not "used" (macOS keeps RAM full of cache on purpose).
- Battery only on battery power.
- Active space on another machine: a dim "This Mac" label leads the numbers, so they never read as the remote host's.
- Narrow window: drop battery, then disk, then the memory total ("21 GB"), before truncating the branch.

### The System popup

A popup anchored above the clicked number, 360px wide, at most half the window high (platform notes: a popup is as
tall as its content; size the root). Same dialog grammar as the port card; tabs are the Library's segmented control
(28px, `raised` track, selected `background`), opening on the tab clicked.

```
┌──────────────────────────────────────────┐
│ [  CPU  ] [ Memory ] [  Disk  ]      Esc │
│ 21.4 of 36 GB            pressure normal │  15px semibold; caption 11.5 dim
│ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░       swap 0 B  │  6px meter, colour rule above
│                                          │
│ By agent                                 │  11.5 dim label
│ [◆] feat/rate-limit-metrics     6.2 GB   │  30px rows; click → that agent
│ [◆] fix/unicode-names           1.1 GB   │
│     Everything else             9.8 GB   │  dim, no mark, not clickable
│                                          │
│ Top processes                            │
│ node  vite  :5173  feat/rate…   2.8 GB   │  port chip → its port card
│ Google Chrome                   2.1 GB   │
│ python             no agent     0.9 GB   │
└──────────────────────────────────────────┘
```

- **CPU**: machine % and core count; By agent (its process tree's share of the machine); top 8 by CPU.
- **Memory**: used of total, pressure (normal / warn / critical), swap; By agent (sum of RSS); top 8 by memory.
- **Disk**: the home volume's free of total; **Worktrees by size**, `du -sk` per worktree Spaces knows, run one at a
  time in a task when the tab opens (never in render: the 100 ms render limit), each with a 30 s timeout, each row
  filling in as it lands ("…" until then, "too big to measure" on timeout), remembered 5 minutes. Largest first; the repo's name dim before the branch. No actions.
- By-agent rows show only agents using ≥ 1% CPU or ≥ 100 MB, so the popup stays short with many agents.
- A port chip closes this popup (`went: true`) and then opens the port card: one popup at a time, never one over
  another.
- Memory by agent is the sum of its processes' resident memory. Shared pages are counted once per process, so the
  rows are a ranking, not a ledger: "Everything else" is the rest's own sum, and the rows aren't claimed to add up to
  "used". CPU rows do add up.
- ← → switch tabs (as every panel's arrows walk its tabs), ↑ ↓ move, ↵ acts on the row, Esc closes; keyboard back to
  where it was on close (`emergence.over`).

### Data

- CPU: from the shared `ps`, as the growth of each process's CPU time (`time=`) between two polls ÷ (interval ×
  cores, `sysctl -n hw.ncpu`). Not `pcpu`: on Linux that is an average over the process's whole life and on macOS a
  slow decay, so neither says "now". One source, so By agent adds up to the total. Until the second poll: "–".
- Numbers are rounded to what is shown (1%, 0.1 GB, 1 GB free) before comparing, so the bar re-renders only when a
  digit changes.
- Memory: `sysctl hw.memsize`, `vm_stat` (used = active + wired + compressed, × the page size in its first line:
  16384 on this Mac, not 4096), `sysctl kern.memorystatus_vm_pressure_level`
  (1 normal, 2 warn, 4 critical), `sysctl vm.swapusage`. Every 5 s.
- Disk: `df -k ~`, every 60 s. Battery: `pmset -g batt`, every 60 s.
- Linux: `/proc/meminfo`, `/proc/pressure/memory`, `df`, `/sys/class/power_supply`. A number whose source is missing
  isn't shown.

## Files

- `mods/ports/`: `main.js` (section: IO and drawing only), `lib.js` (pure: `parseLsof`, `parsePs`, `chain`,
  `owners`, `servers`, `url`, `isWeb`), `lib.test.js`, Lucide SVGs (`globe`, `copy`, `external-link`).
  `mods/port-card/`: the card (an overlay is a mod of its own, as confirm-safe and row-menu are).
- One block of named constants per mod (poll interval, row cap, thresholds, the non-web table): no numbers in the code.
- `mods/status-plus/`: `main.js` (bar), the popup mod, `lib.js` (vm_stat / sysctl / df / pmset parsing),
  `lib.test.js`, Lucide `cpu`, `memory-stick`, `hard-drive`, `battery-low`, `battery-medium`.
- `layouts/emergence.json`: the `ports` block; `status` → `status-plus`.
- `keys.json`: `mod:ports`; `mod:inbox` gains ctrl-j → `ports.focus`. `install.sh` already merges a new section and a
  new key in an existing section for people who have Emergence installed (read; no installer change needed).
  `mods/emergence-keys` (⌘⇧/) lists the new keys; README's Remove steps name `mod:ports`.
- README (Sidebar bullet, a Status bar section, "What it runs", keys table, Develop table), RECIPE.md (both parts in
  "What you see" and "How it behaves"), `install.test.sh` if it lists mods.

## What to verify before building (each has a fallback above)

1. Does `terminals()` carry `pid` and `foreground.pid`? Else `hc get` per terminal.
2. Does a popup opened from the keyboard at `at: {x, y}` take the keyboard as row-menu does?
3. Does a mod import `../ports/lib.js` across mod folders (through the install's symlinks)? Else copy the functions.
4. Is "collapsed" (commands don't arrive) the rail, the dots, or only hidden? Decides when ctrl-j → `ports.focus`
   can arrive; Stop no longer depends on it.

## Tests (lib.test.js, recorded output)

`lsof` with `*:7000`, `127.0.0.1:5173`, `[::1]:3000`, the same pid on both families, two pids on one port in one
tree, two unrelated pids on one port number; `ps` with spaces in `comm`; a server whose parent is pid 1 inside a
worktree, inside a nested worktree, inside a Claude scratchpad, under an agent started in `~`; a remote terminal
whose pid equals a local one; the agent's own port; Docker; CPU from two samples, a process that exited between
them, the first sample.

## Later (not in this work)

- A `:5173` chip on agent cards in the Agents graph, opening the port card.
- Docker container names on Docker-owned ports.

## Left to the builder

Pixel nudges within the patterns named above; the process name shown (lsof's command, trimmed; `node` gets its
script's name when argv makes it obvious: `vite`, `next`); whether the process→agent link lives in one `lib.js` both
mods import or is copied (the repo copies today: inbox's `clean` from agent-graph); what to show if `lsof` is missing
(one dim line: "lsof not found").
