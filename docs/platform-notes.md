# herdr-mods: platform notes

Herdr's manual is `~/.config/herdr-app/AGENTS.md`; types are `herdr.d.ts` and `gpui-kit.d.ts` (800 KB: grep it).
These are the Herdr 0.1.15 behaviours we hit that the manual gets wrong or leaves out. Each was seen live.

## Sizes and zoom

- `on_size_change` reports real px (zoom applied), not the logical px the manual says: divide by `settings().zoom`.
  `mods/blueprint/main.js:39-43` agrees; a Library panel at 780 px with zoom 1.1 lays out as wide.
- `PathBuilder` coordinates are zoom-scaled like element px: draw them in the same units as `.left()`/`.top()`.
  agent-graph's edges meet its cards at zoom 1.1 with no extra factor (blueprint's comment says otherwise).
- A popup is as tall as its content (mod.json `height` is a cap): give the root `viewport_size().height * share / zoom`.
- `line_height` takes a string (`"17px"`), not a number.

## Layout state

- A shown panel node has no `hidden` key: test `!node.hidden`, never `node.hidden === false`.
- A collapsed column counts as not shown, and `<mod>.<command>` only reaches shown copies ("unknown command").
  A block that must always get commands (nav-keys) belongs in the `work` column, never the sidebar.
- Panel copies and windows don't pick up file edits: restart them with `layout.switch` main → factory.

## Windows

- An invisible window (`frame: "none"`, empty view) still takes every press, and a press drags it. A kept
  window stays where it was dropped (`windows.json` `places`) across restarts and layouts. nav-keys' 1 px
  window once ended up over the panel column and ate all its clicks, scrolls and hovers.
  Host resident mods in a 0 px layout block instead.
- `herdr-app do overlay.close --id <key>` doesn't close a window, nor the worktree dialog; `overlay.close`
  with no id closes the top dialog. The mod's own `closeOverlay(props().overlay)` closes a window and
  un-keeps it for that layout.
- `openOverlay` with an open window's `key` replaces it in place, with the new spec's size.

## Runtime

- `fs/promises` has no `appendFile` (calling it throws inside the handler). `readTextFile` of a missing file
  resolves `null`, and `JSON.parse(null)` is `null`.
- `props()` is `null` under `herdr-app check`. A View method named `close` collides with the lifecycle
  `async close(cx)`: use another name (`dismiss`).
- `InputState.set_value` doesn't fire `change`.

## Verifying UI

- Never synthesize OS mouse or keyboard events: Herdr usually isn't frontmost and they land in another app.
- Drive the real handlers through a temporary `nextCommand()` loop (`herdr-app do <mod>.<cmd>`), check with
  `herdr-app shot` and `herdr-app status`, then delete the loop before committing.
- To learn whether pointer events arrive at all, log from the handlers into memory and flush it with
  `fs.writeFile` under `~/.config/herdr-app/data/`, then ask the person to click.
- A synthetic agent for a test: a terminal that prints `\033]7501;state=<working|blocked|done|idle>:app=<claude|codex|pi|…>\033\\`
  (and an OSC 0 title) and then sleeps shows up in `agents()` with that program's icon. `done` needs a
  `working` report first and must land while another tab is in front, else it reads as idle. Start it with
  `tab.new {folder, argv}`, label it `herdr-mods-test=1`, close the tab after.
