#!/usr/bin/env bash
# Copies shared/keyboard*.js (not tests) into every mod that opted in by having mods/<name>/keyboard.js.
#   scripts/sync-shared.sh          write the copies
#   scripts/sync-shared.sh --check  exit 1 if any copy differs from shared/ (CI)
set -euo pipefail
cd "$(dirname "$0")/.."
check=${1:-}
status=0
for mod in mods/*/; do
  [ -f "$mod/keyboard.js" ] || continue
  for src in shared/keyboard.js shared/keyboard-lib.js; do
    dst="$mod$(basename "$src")"
    if [ "$check" = "--check" ]; then
      cmp -s "$src" "$dst" || { echo "::error file=$dst::differs from $src: run scripts/sync-shared.sh"; status=1; }
    else
      cp "$src" "$dst"
    fi
  done
done
exit $status
