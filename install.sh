#!/usr/bin/env bash
# Links every mod in ./mods and layout in ./layouts into the Herdr app home,
# merges ./keys.json, and switches to the `factory` layout (panels in the tab bar).
# Safe to rerun. Never replaces a file, folder or key it didn't create.
set -euo pipefail
shopt -s nullglob

repo="$(cd "$(dirname "$0")" && pwd)"
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

python3 - "$repo/keys.json" "$home/keys.json" <<'PY'
import json, sys, os
ours = json.load(open(sys.argv[1]))
path = sys.argv[2]
theirs = json.load(open(path)) if os.path.exists(path) else {}
changed = False
for section, binds in ours.items():
    current = theirs.setdefault(section, {})
    for key, action in binds.items():
        if key not in current:
            current[key] = action; changed = True
            print(f"bound   {key} -> {action}")
        elif current[key] != action:
            print(f"skip    {key} (already bound to {current[key]})", file=sys.stderr)
if changed:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(theirs, f, indent=2); f.write("\n")
    os.replace(tmp, path)
PY

if herdr-app status >/dev/null 2>&1; then
  for dir in "$repo"/mods/*/; do herdr-app check "$home/mods/$(basename "$dir")"; done
  herdr-app do layout.switch --name factory >/dev/null && echo "layout  factory (ctrl-shift-l cycles back)"
fi
