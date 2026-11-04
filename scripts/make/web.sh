#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
ENV_DIR="${ENV_DIR:-cloud/deploy-config/env-files}"
[ -f cloud/deploy-config/compose.hosted.yml ] || { echo "make web: cloud/ is not in this checkout; the hosted preview needs it" >&2; exit 1; }
node cloud/deploy-config/scripts/env-check.mjs --dir "$ENV_DIR"
need_docker web
command -v jq >/dev/null 2>&1 || { echo "make web: jq is missing (brew install jq); the preflight needs it" >&2; exit 1; }
unset PREVIEW_AGENT_PORT PREVIEW_WEB_PORT OPEN_AGENT_PORT
clean_env
P=(env -i "${CLEAN_ENV[@]}" docker compose -p "$PREVIEW_PROJECT" --env-file "$ENV_DIR/backend/.env" --env-file "$ENV_DIR/frontend/.env" "${PREVIEW_FILES[@]}")
. scripts/preview-preflight.sh
preflight "${P[@]}" || exit 1
"${P[@]}" up -d --build --wait search renderer agent web
echo "make web: Open Agent (hosted preview) is up: http://localhost:18300 (agent health: http://127.0.0.1:18800/health). Stop it with make stop."
