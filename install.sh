#!/usr/bin/env bash
# Links every mod in ./mods and layout in ./layouts into the Herdr app home,
# merges ./keys.json and ./programs.json (omp's icon), and switches to the `factory` layout.
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

python3 - "$repo" "$home" <<'PY'
import json, sys, os
for name in ("keys.json", "programs.json"):
    ours = json.load(open(os.path.join(sys.argv[1], name)))
    path = os.path.realpath(os.path.join(sys.argv[2], name))  # may be a dotfiles symlink: write through it
    theirs = json.load(open(path)) if os.path.exists(path) else {}
    changed = False
    for section, entries in ours.items():
        current = theirs.setdefault(section, {})
        for key, value in entries.items():
            shown = f"{key} -> {value}" if name == "keys.json" else f"{name} {key}"
            if key not in current:
                current[key] = value; changed = True
                print(f"added   {shown}")
            elif current[key] != value:
                print(f"skip    {name} {key} (already set to {current[key]})", file=sys.stderr)
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
