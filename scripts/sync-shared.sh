#!/usr/bin/env bash
# Copies each shared/*.js (not tests) into every mod that opted in by having a file of that name
# (keyboard.js and keyboard-lib.js: the keyboard rules; slots.js: side chats' slots).
#   scripts/sync-shared.sh          write the copies
#   scripts/sync-shared.sh --check  exit 1 if any copy differs from shared/ (CI)
set -euo pipefail
cd "$(dirname "$0")/.."
check=${1:-}
status=0
for src in shared/*.js; do
  case "$src" in *.test.js) continue ;; esac
  for mod in mods/*/; do
    dst="$mod$(basename "$src")"
    [ -f "$dst" ] || continue
    if [ "$check" = "--check" ]; then
      cmp -s "$src" "$dst" || { echo "::error file=$dst::differs from $src: run scripts/sync-shared.sh"; status=1; }
    else
      cp "$src" "$dst"
    fi
  done
done
exit $status
