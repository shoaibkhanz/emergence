#!/usr/bin/env bash
# Checks install.sh and the Update chip's script (mods/tabs-plus/main.js UPDATE) against temp homes, a local
# origin and a stub herdr-app. Needs git and python3, no Herdr; touches nothing outside its temp folder.
#   bash install.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
t="$(mktemp -d)"; trap 'rm -rf "${t:?}"' EXIT # its own line: a failed mktemp stops here, before anything is removed
t="$(cd "$t" && pwd -P)"
fail() { echo "FAIL: $*" >&2; exit 1; }
val() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], {}).get(sys.argv[3], "-"))' "$@"; }
is() { [ "$(val "$1" "$2" "$3")" = "$4" ] || fail "$(basename "$1") $2 $3 is $(val "$1" "$2" "$3"), not $4"; }

# A stub herdr-app that logs its calls and says emergence shows; git with no user config, and GitHub's URL
# pointed at a local origin holding this working tree.
mkdir "$t/bin" "$t/src"
printf '#!/bin/sh\necho "$*" >> "%s/herdr.log"\nif [ "$1" = status ]; then echo \047  "layout": "emergence",\047; fi\n' "$t" > "$t/bin/herdr-app"
chmod +x "$t/bin/herdr-app"
export PATH="$t/bin:$PATH" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$t/gitconfig" EMERGENCE_UPDATE=1
unset EMERGENCE_DIR HERDR_APP_HOME
git config --global user.name test; git config --global user.email test@example.com
git config --global init.defaultBranch main; git config --global advice.detachedHead false
git config --global "url.$t/origin.git.insteadOf" https://github.com/shoaibkhanz/emergence
(cd "$here" && git ls-files -co --exclude-standard -z | xargs -0 tar cf - 2>/dev/null) | tar xf - -C "$t/src"
git -C "$t/src" init -q; git -C "$t/src" add -A; git -C "$t/src" commit -qm base
git clone -q --bare "$t/src" "$t/origin.git"
push() { git -C "$t/src" add -A; git -C "$t/src" commit -qm "$1"; git -C "$t/src" push -q "$t/origin.git" main; }

# 1. Piped, on a home that doesn't exist yet, into paths with spaces.
clone="$t/my code/emergence"; home="$t/app home"; keys="$home/keys.json"
install() { HERDR_APP_HOME="$home" bash "$clone/install.sh" 2>&1; }
EMERGENCE_DIR="$clone" HERDR_APP_HOME="$home" bash < "$here/install.sh" >/dev/null
for m in "$clone"/mods/*/; do [ "$(readlink "$home/mods/$(basename "$m")")" = "${m%/}" ] || fail "mods/$(basename "$m") not linked"; done
[ "$(readlink "$home/layouts/emergence.json")" = "$clone/layouts/emergence.json" ] || fail "layout not linked"
is "$keys" global cmd-e mod.open:jump
is "$keys" layout:emergence cmd-b tabs-plus.rail
[ "$(val "$home/programs.json" programs omp)" != - ] || fail "omp not in programs.json"

# 2. Again: nothing changes. Also by a path that is a link to the clone (the Update chip runs the real path).
before="$(cat "$keys")"; out="$(install)"
[ -z "$(echo "$out" | grep -v '^ok ')" ] || fail "rerun changed something: $out"
ln -s "$clone" "$t/alias"; out="$(HERDR_APP_HOME="$home" bash "$t/alias/install.sh" 2>&1)"
[ -z "$(echo "$out" | grep -v '^ok ')" ] || fail "rerun through a linked path changed something: $out"
[ "$(cat "$keys")" = "$before" ] || fail "rerun rewrote keys.json"

# 3. An old copy, a link into another clone, a link to a mod we no longer have, and somebody else's dead link.
rm "$home/mods/jump" "$home/mods/inbox" "$home/layouts/emergence.json"
mkdir "$home/mods/jump"; echo old > "$home/mods/jump/main.js"; echo '{}' > "$home/layouts/emergence.json"
ln -s "$t/other/mods/inbox" "$home/mods/inbox"; ln -s "$clone/mods/gone" "$home/mods/gone"; ln -s "$t/nowhere" "$home/mods/theirs"
install >/dev/null
[ "$(readlink "$home/mods/jump")" = "$clone/mods/jump" ] && [ "$(readlink "$home/mods/inbox")" = "$clone/mods/inbox" ] || fail "old copies not replaced by links"
[ -L "$home/layouts/emergence.json" ] || fail "old layout copy not replaced"
[ "$(cat "$home"/replaced/jump.*/main.js)" = old ] || fail "old copy not kept in replaced/"
[ ! -L "$home/mods/gone" ] || fail "link to a removed mod stays"
[ -L "$home/mods/theirs" ] || fail "someone else's link was removed"

# 4. Their keys stay; old keys of ours move; keys.json may be a link into dotfiles.
mkdir "$t/dotfiles"; rm "$keys"; ln -s "$t/dotfiles/keys.json" "$keys"
cat > "$t/dotfiles/keys.json" <<'JSON'
{ "global": { "cmd-e": "app.palette", "cmd-shift-k": "tab.new", "cmd-b": "layout.toggle:sidebar", "ctrl-t": "tab.new",
              "cmd-shift-g": "tabs-plus.graph", "cmd-shift-u": "tabs-plus.prs", "cmd-shift-m": "tabs-plus.usage" },
  "layout:emergence": { "cmd-shift-o": "space.next", "cmd-shift-j": "tabs-plus.attention" } }
JSON
out="$(install)"
[ -L "$keys" ] || fail "keys.json link replaced by a file"
is "$keys" global cmd-e app.palette;              is "$keys" global ctrl-t tab.new
is "$keys" global cmd-shift-k tab.new;            is "$keys" layout:emergence cmd-shift-k -          # their global key wins
is "$keys" layout:emergence cmd-shift-o space.next
is "$keys" layout:emergence cmd-b tabs-plus.rail                                                     # Herdr's default may be shadowed
is "$keys" global cmd-shift-g -;                  is "$keys" layout:emergence cmd-shift-a tabs-plus.graph
is "$keys" global cmd-shift-u -;                  is "$keys" layout:emergence cmd-shift-r tabs-plus.prs
is "$keys" global cmd-shift-m -;                  is "$keys" layout:emergence cmd-shift-u tabs-plus.usage
is "$keys" layout:emergence cmd-shift-j -;        is "$keys" layout:emergence cmd-shift-i tabs-plus.attention
echo "$out" | grep -q 'skip .*cmd-e' || fail "a skipped key isn't reported"

# 5. A keys.json that isn't JSON stops the install with its name, untouched.
echo '{ oops' > "$t/dotfiles/keys.json"
out="$(install)" && fail "a broken keys.json didn't stop the install"
echo "$out" | grep -q 'keys.json' || fail "the error doesn't name keys.json: $out"
[ "$(cat "$t/dotfiles/keys.json")" = '{ oops' ] || fail "a broken keys.json was rewritten"
rm "$keys"; install >/dev/null

# 6. Without git or python3: says so, before touching anything.
out="$(PATH="$t/bin" HERDR_APP_HOME="$t/none" "$(command -v bash)" "$clone/install.sh" 2>&1)" && fail "no git, yet it ran"
echo "$out" | grep -q 'needs git' || fail "missing git not named: $out"
[ ! -e "$t/none" ] || fail "it wrote before checking for git"

# 7. Run by hand (no EMERGENCE_UPDATE) while emergence shows: checks every mod, reloads via main.
: > "$t/herdr.log"; (unset EMERGENCE_UPDATE; install >/dev/null)
[ "$(grep -c '^check ' "$t/herdr.log")" = "$(ls -d "$clone"/mods/*/ | wc -l | tr -d ' ')" ] || fail "not every mod checked"
[ "$(grep '^do ' "$t/herdr.log" | tr '\n' ';')" = "do layout.switch --name main;do layout.switch --name emergence;" ] || fail "no reload via main: $(cat "$t/herdr.log")"

# 8. The Update chip's script: pulls, links a new mod, reloads only when mods or layouts changed.
python3 - "$here/mods/tabs-plus/main.js" > "$t/update.sh" <<'PY'
import json, re, sys
src = open(sys.argv[1]).read()
fetch = " ".join(json.loads(re.search(r"const FETCH = (\[.*?\]);", src).group(1)))
print(re.search(r"const UPDATE = `(.*?)`;", src, re.S).group(1).replace('${FETCH.join(" ")}', fetch))
PY
update() { HERDR_APP_HOME="$home" bash -c "$(cat "$t/update.sh")" update "$clone" 2>&1; }
same() { [ "$(git -C "$clone" rev-parse HEAD)" = "$(git -C "$t/origin.git" rev-parse main)" ]; }
mkdir "$t/src/mods/newmod"; echo x > "$t/src/mods/newmod/main.js"; push "a new mod"
: > "$t/herdr.log"; update >/dev/null || fail "update failed"
same || fail "update didn't pull"
[ -L "$home/mods/newmod" ] || fail "update didn't link the new mod"
[ "$(grep -c 'layout.switch' "$t/herdr.log")" = 2 ] || fail "update didn't reload the layout"
echo more >> "$t/src/README.md"; push "docs only"
: > "$t/herdr.log"; update >/dev/null || fail "docs-only update failed"
same || fail "docs-only update didn't pull"
! grep -q 'layout.switch' "$t/herdr.log" || fail "a docs-only update reloaded the layout"

# 9. It refuses, changing nothing, off main or with commits of its own, and says why on stderr.
echo more >> "$t/src/README.md"; push "next"
git -C "$clone" checkout -q -b side; out="$(update)" && fail "updated off main"
echo "$out" | grep -q 'not on main' || fail "off main: $out"
git -C "$clone" checkout -q main; git -C "$clone" commit -q --allow-empty -m mine; mine="$(git -C "$clone" rev-parse HEAD)"
out="$(update)" && fail "updated over local commits"
echo "$out" | grep -Eq '^(fatal|error): ' || fail "diverged: $out"
[ "$(git -C "$clone" rev-parse HEAD)" = "$mine" ] || fail "a refused update moved HEAD"
out="$(EMERGENCE_DIR="$clone" HERDR_APP_HOME="$home" bash < "$here/install.sh" 2>&1)" && fail "installed over a clone that can't pull"
echo "$out" | grep -q "^error: .*Move it aside" || fail "a clone that can't pull: $out"

# 10. A pull that landed before a later step failed still reloads on the retry.
git -C "$clone" reset -q --hard HEAD~1; echo y > "$t/src/mods/newmod/main.js"; push "mod change"
echo '{ oops' > "$keys"; out="$(update)" && fail "updated with a broken keys.json"
echo "$out" | grep -q "^error: .*keys.json" || fail "broken keys.json on update: $out"
rm "$keys"; : > "$t/herdr.log"; update >/dev/null || fail "retry failed"
[ "$(grep -c 'layout.switch' "$t/herdr.log")" = 2 ] || fail "the retry didn't reload the layout"

echo "install.test.sh: ok"
