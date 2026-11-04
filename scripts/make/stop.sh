#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
rc=0
bash scripts/make/web-local.sh stop || rc=$?
if pgrep -xq "Open Agent"; then
  osascript -e 'quit app "Open Agent"' >/dev/null 2>&1 || true
  echo "make stop: asked the Open Agent app to quit"
fi
if ! docker info >/dev/null 2>&1; then
  echo "make stop: Docker is not running; nothing to stop"
  exit "$rc"
fi
if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$PREVIEW_PROJECT")" ]; then
  clean_env
  env -i "${CLEAN_ENV[@]}" RENDERER_SECRET=unused-by-down docker compose -p "$PREVIEW_PROJECT" --env-file /dev/null "${PREVIEW_FILES[@]}" down
  echo "make stop: $PREVIEW_PROJECT is down (volumes kept)"
else
  echo "make stop: $PREVIEW_PROJECT is not running"
fi
ids="$(docker ps -q --filter label=com.docker.compose.project=open-agent)"
if [ -n "$ids" ]; then
  docker stop $ids >/dev/null
  echo "make stop: stopped the desktop app's services (project open-agent; volumes kept)"
else
  echo "make stop: the desktop app's services are not running"
fi
exit "$rc"
