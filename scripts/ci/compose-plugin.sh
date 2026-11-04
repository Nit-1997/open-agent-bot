#!/usr/bin/env bash
set -euo pipefail

VERSION=v5.7.0
case "$(uname -m)" in
  x86_64) ARCH=x86_64 SHA256=7758048ad38e580f22559603312874fec8bb638d021a9e64182385fc17cc12a2 ;;
  aarch64) ARCH=aarch64 SHA256=15861535d14e26555736b49376c95e14bfd94285366c8446bfac7156a972e76f ;;
  *) echo "compose-plugin: refused: no pinned Docker Compose build for $(uname -m)" >&2; exit 2 ;;
esac

DIR="${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
mkdir -p "$DIR"
TMP="$(mktemp "$DIR/.docker-compose.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
curl -fsSL --retry 3 -o "$TMP" "https://github.com/docker/compose/releases/download/$VERSION/docker-compose-linux-$ARCH"
echo "$SHA256  $TMP" | sha256sum -c --quiet -
chmod 755 "$TMP"
mv "$TMP" "$DIR/docker-compose"
trap - EXIT
docker compose version
