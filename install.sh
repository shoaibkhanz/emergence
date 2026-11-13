#!/usr/bin/env bash
# Emergence installer. One command, from anywhere (run it again to update):
#   curl -fsSL https://raw.githubusercontent.com/shoaibkhanz/emergence/main/install.sh | bash
# Clones (or pulls) the repo into ~/code/emergence (EMERGENCE_DIR moves it), links every mod and layout into the
# Herdr app home, merges keys.json and programs.json (omp's icon), checks each mod and switches to the `emergence` layout.
# Safe to rerun. Never replaces a file, folder or key it didn't create.
set -euo pipefail
shopt -s nullglob

# Piped, or run outside a clone: get the clone first, then run its own copy of this script.
src="${BASH_SOURCE[0]:-}"
if [ -z "$src" ] || [ ! -f "$(dirname "$src")/layouts/emergence.json" ]; then
  dir="${EMERGENCE_DIR:-$HOME/code/emergence}"
  if [ -d "$dir/.git" ]; then git -C "$dir" pull --ff-only --quiet; else git clone --quiet https://github.com/shoaibkhanz/emergence "$dir"; fi
  exec bash "$dir/install.sh"
fi
repo="$(cd "$(dirname "$src")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

link() { # link <repo path> <home path> <label>
  if [ -L "$2" ] && [ "$(readlink "$2")" = "$1" ]; then
    echo "ok      $3"
  elif [ -e "$2" ] || [ -L "$2" ]; then
    echo "skip    $3 (exists and is not ours)" >&2
  else
    ln -s "$1" "$2" && echo "linked  $3"
  fi
}
for dir in "$repo"/mods/*/; do
  name="$(basename "$dir")"; link "${dir%/}" "$home/mods/$name" "mods/$name"
done
for file in "$repo"/layouts/*.json; do
  name="$(basename "$file")"; link "$file" "$home/layouts/$name" "layouts/$name"
done
# Our links to files this repo no longer has (a renamed mod or layout) go.
for l in "$home"/mods/* "$home"/layouts/*; do
  if [ -L "$l" ] && [ ! -e "$l" ]; then case "$(readlink "$l")" in "$repo"/*) rm "$l" && echo "removed $(basename "$l") (no longer in the repo)";; esac; fi
done

python3 - "$repo" "$home" <<'PY'
import json, sys, os
# Keys we used to add, as (section, key, action): each goes while it still holds that action, but only once the
# action's key in ours is in their file or free to add, so no action is left without a key. A layout key isn't
# free while a global binding holds that key for something else (it would shadow it in the layout), except the
# Herdr default the layout key exists to replace (SHADOWS).
SHADOWS = {"cmd-b": "layout.toggle:sidebar"}
RETIRED = {"keys.json": [("global", k, "tabs-plus." + a) for k, a in (
    ("cmd-shift-g", "graph"), ("cmd-shift-u", "prs"), ("cmd-shift-m", "usage"),  # before ⌘⇧A, ⌘⇧R, ⌘⇧U
    ("cmd-shift-a", "graph"), ("cmd-shift-r", "prs"), ("cmd-shift-k", "skills"),  # global until they moved to layout:emergence
    ("cmd-shift-u", "usage"), ("cmd-shift-j", "attention"), ("cmd-shift-o", "worktrees"))]}
for name in ("keys.json", "programs.json"):
    ours = json.load(open(os.path.join(sys.argv[1], name)))
    path = os.path.realpath(os.path.join(sys.argv[2], name))  # may be a dotfiles symlink: write through it
    theirs = json.load(open(path)) if os.path.exists(path) else {}
    changed = False
    retired = RETIRED.get(name, [])
    def free(section, key, value):
        held = theirs.get("global", {}).get(key) if section.startswith("layout:") else None
        return theirs.get(section, {}).get(key, value) == value and held in (None, value, SHADOWS.get(key))
    # Again until nothing goes: one going can free another's new key (old ⌘⇧U -> prs holds usage's).
    while gone := [(s, k, v) for s, k, v in retired if theirs.get(s, {}).get(k) == v and ours.get(s, {}).get(k) != v
                   and any(free(s2, k2, v) for s2, e in ours.items() for k2, v2 in e.items() if v2 == v)]:
        for section, key, value in gone:
            del theirs[section][key]; changed = True
            print(f"removed {section} {key} -> {value}")
    for section, entries in ours.items():
        current = theirs.setdefault(section, {})
        for key, value in entries.items():
            where = f"{section} {key}" if name == "keys.json" else f"{name} {key}"
            if current.get(key) == value:
                continue
            if free(section, key, value):
                current[key] = value; changed = True
                print(f"added   {where}" + (f" -> {value}" if name == "keys.json" else ""))
            else:
                why = f"already set to {current[key]}" if key in current else f"global {key} stays {theirs['global'][key]}"
                print(f"skip    {where} ({why})", file=sys.stderr)
    if changed:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(theirs, f, indent=2); f.write("\n")
        os.replace(tmp, path)
PY

if [ -z "${EMERGENCE_UPDATE:-}" ] && herdr-app status >/dev/null 2>&1; then
  for dir in "$repo"/mods/*/; do herdr-app check "$home/mods/$(basename "$dir")"; done
  # Switching to the shown layout is a no-op, and a pull into the clone isn't a save Herdr sees (the mods are links),
  # so an emergence already showing goes via main to load the new mod code.
  if herdr-app status | grep -q '"layout": "emergence"'; then herdr-app do layout.switch --name main >/dev/null && sleep 1; fi
  if herdr-app do layout.switch --name emergence >/dev/null; then echo "layout  emergence, reloaded (cmd-shift-l cycles back)"
  else echo "reload  couldn't switch layouts: switch to another layout and back (cmd-shift-l) to load the new mods" >&2; fi
fi
