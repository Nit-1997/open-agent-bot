#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
need_docker app
[ -d node_modules ] || npm ci
case "$(uname -m)" in
  arm64) arch=arm64; dir=mac-arm64 ;;
  x86_64) arch=x64; dir=mac ;;
  *) echo "make app: unsupported machine $(uname -m)" >&2; exit 1 ;;
esac
version="$(node -p 'require("./apps/desktop/package.json").version')"
dmg="apps/desktop/release/Open-Agent-$version-$arch.dmg"
app="apps/desktop/release/$dir/Open Agent.app"
stamp_file="apps/desktop/release/.make-app-$arch"
stamp() {
  git rev-parse HEAD
  git diff HEAD --binary
  git ls-files -o --exclude-standard -z | xargs -0 stat -f '%N %m %z' 2>/dev/null || true
}
want="$(stamp | shasum -a 256 | cut -d' ' -f1)"
if [ -f "$dmg" ] && [ -d "$app" ] && [ "$(cat "$stamp_file" 2>/dev/null || true)" = "$want" ]; then
  echo "make app: reusing $dmg (built from this exact checkout)"
else
  npm run dist:local -w @oab/desktop
  [ -d "$app" ] || { echo "make app: the build did not produce $app" >&2; exit 1; }
  printf '%s\n' "$want" > "$stamp_file"
fi
open "$app"
echo "make app: opened $app (installer: $dmg). Stop its services with make stop."
