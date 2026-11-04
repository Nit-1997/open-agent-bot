#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "0. guards (read-only): live stack, real volumes, real app state, leftovers"
expect live-before "1=no open-agent-bot containers listed (grep found none)" \
  "docker ps --format '{{.Names}} {{.State}} {{.CreatedAt}}' | grep -E '^open-agent-bot' | sort > \"$DEMO_DIR/live-before.txt\""
note "status column (for reading; not diffed because 'Up N hours' moves on):"
docker ps --format '{{.Names}} {{.Status}}' | grep -E '^open-agent-bot' | sed 's/^/   /' || true
cat "$DEMO_DIR/live-before.txt"
expect realvols-before "1=no real open-agent-data/-keys volume exists (grep found none)" \
  "docker volume ls --format '{{.Name}}' | grep -E '^open-agent-(data|keys)$' > \"$DEMO_DIR/realvols-before.txt\""
cat "$DEMO_DIR/realvols-before.txt"
if docker compose ls -a --format json | jq -r '.[].Name' | grep -qx open-agent; then
  record no-open-agent-project 1 "ABORT: a real open-agent compose project exists"
  echo "ABORT: a real open-agent project exists"
  exit 1
fi
record no-open-agent-project 0 ""
note "no open-agent compose project"
for d in "Application Support/Open Agent" "Logs/Open Agent"; do stat -f '%m %N' "$HOME/Library/$d" 2>/dev/null || echo "absent $d"; done > "$DEMO_DIR/realstate-before.txt"
cat "$DEMO_DIR/realstate-before.txt"
absent no-m5-leftovers "no M5 containers, builder or volumes left from an earlier run (grep found none)" \
  "{ docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker buildx ls --format '{{.Name}}'; } | grep -E '^oab-(factory-)?m5'"
