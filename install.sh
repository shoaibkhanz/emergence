#!/usr/bin/env bash
# Links every mod in ./mods into the Herdr app home and merges ./keys.json.
# Safe to rerun. Never replaces a mod folder or key it didn't create.
set -euo pipefail
shopt -s nullglob

repo="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

for dir in "$repo"/mods/*/; do
  name="$(basename "$dir")"
  target="$home/mods/$name"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "${dir%/}" ]; then
    echo "ok      mods/$name"
  elif [ -e "$target" ] || [ -L "$target" ]; then
    echo "skip    mods/$name (exists and is not ours)" >&2
  else
    ln -s "${dir%/}" "$target" && echo "linked  mods/$name"
  fi
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

herdr-app status >/dev/null 2>&1 && for dir in "$repo"/mods/*/; do herdr-app check "$home/mods/$(basename "$dir")"; done || true
