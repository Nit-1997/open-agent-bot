#!/bin/sh
set -eu
file="${SEARXNG_SECRET_FILE:-/var/lib/searxng-secret/secret}"
if [ ! -s "$file" ]; then
  mkdir -p "$(dirname "$file")"
  (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$file")
fi
SEARXNG_SECRET="$(cat "$file")"
export SEARXNG_SECRET
exec "$@"
