#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
: "${ENV_DIR:?run it as make test-e2e}"

PARENT="${OAB_E2E_TMP_PARENT:-${TMPDIR:-/tmp}}"
PARENT="${PARENT%/}"
[ -d "$PARENT" ] || { echo "make test-e2e: $PARENT does not exist; set OAB_E2E_TMP_PARENT to a private folder" >&2; exit 1; }
if [ -n "$(find -H "$PARENT" -maxdepth 0 -perm -0002)" ]; then
  echo "make test-e2e: $PARENT is writable by others (the shell refuses a docker CLI there); set OAB_E2E_TMP_PARENT to a private folder" >&2
  exit 1
fi
need_docker test-e2e
command -v jq >/dev/null 2>&1 || { echo "make test-e2e: jq is missing (brew install jq); the preflight needs it" >&2; exit 1; }

PROJECT=oab-e2e-desktop
AGENT_IMAGE=oab-e2e-agent:dev
SEARCH_IMAGE=oab-e2e-search:dev
LOCAL_PREFIX=oab-e2e-
T="$(mktemp -d "$PARENT/oab-e2e.XXXXXX")"
chmod 700 "$T"
export TMPDIR="$T"
. scripts/preview-preflight.sh

teardown() {
  local p
  for p in "$PROJECT" "$PROJECT-lb"; do
    local C=(env OPEN_AGENT_DATA_VOLUME="$p-data" OPEN_AGENT_KEYS_VOLUME="$p-keys" OPEN_AGENT_PORT=18480
      docker compose -p "$p" -f docker-compose.yml --env-file /dev/null)
    if preflight "${C[@]}" >/dev/null; then
      "${C[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    else
      echo "make test-e2e: preflight refused to tear down $p; left it alone" >&2
    fi
  done
  docker image rm "$AGENT_IMAGE" "$SEARCH_IMAGE" "${LOCAL_PREFIX}open-agent:local" "${LOCAL_PREFIX}open-agent-search:local" >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap teardown EXIT

X=()
[ "$(uname)" = Linux ] && [ -z "${DISPLAY:-}" ] && X=(xvfb-run -a)

RESULTS=()
suite() {
  local name="$1" rc=0
  shift
  echo "make test-e2e: $name"
  "$@" || rc=$?
  RESULTS+=("$name: $([ "$rc" = 0 ] && echo pass || echo "FAIL (exit $rc)")")
}

desktop_fake() {
  (cd e2e && ${X[@]+"${X[@]}"} npx playwright test -c playwright.desktop.config.ts --project desktop-fake)
}

desktop_real() {
  docker build -q -f packages/core/Dockerfile --build-arg OPEN_AGENT_VERSION=0.0.0-dev -t "$AGENT_IMAGE" . >/dev/null || return 1
  docker build -q --build-arg OPEN_AGENT_VERSION=0.0.0-dev -t "$SEARCH_IMAGE" local/searxng >/dev/null || return 1
  node -e '
    const fs = require("node:fs");
    const sha = require("node:crypto").createHash("sha256").update(fs.readFileSync("docker-compose.yml")).digest("hex");
    const [out, agent, search] = process.argv.slice(1);
    fs.writeFileSync(out, JSON.stringify({ schema: 1, kind: "dev", version: "0.0.0-dev", composeSha256: sha, images: { agent, search }, pull: false }));
  ' "$T/dev-services.json" "$AGENT_IMAGE" "$SEARCH_IMAGE" || return 1
  (cd e2e && DESKTOP_REAL_DOCKER=1 DESKTOP_REAL_SERVICES="$T/dev-services.json" DESKTOP_REAL_PROJECT="$PROJECT" \
    DESKTOP_REAL_RANGE=18480-18482 DESKTOP_LOCAL_RANGE=18484-18485 STUB_PORT=18483 DESKTOP_REAL_AGENT_IMAGE="$AGENT_IMAGE" \
    DESKTOP_LOCAL_PREFIX="$LOCAL_PREFIX" DESKTOP_REAL_EVIDENCE="$PWD/test-results/desktop/evidence" \
    ${X[@]+"${X[@]}"} npx playwright test -c playwright.desktop.config.ts --project desktop-real)
}

hosted_preview() {
  local running=0 rc=0
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$PREVIEW_PROJECT")" ] && running=1
  bash scripts/make/web.sh || rc=$?
  if [ "$rc" = 0 ]; then
    for url in http://127.0.0.1:18800/health http://localhost:18300/login; do
      code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
      echo "make test-e2e: $url -> $code"
      [ "$code" = 200 ] || rc=1
    done
  fi
  if [ "$running" = 0 ]; then
    clean_env
    env -i "${CLEAN_ENV[@]}" RENDERER_SECRET=unused-by-down docker compose -p "$PREVIEW_PROJECT" --env-file /dev/null "${PREVIEW_FILES[@]}" down >/dev/null 2>&1 || true
  fi
  return "$rc"
}

npm run electron:install -w @oab/desktop
npm run build -w @oab/desktop
npm run stage -w @oab/desktop
suite "desktop e2e with the fake docker CLI" desktop_fake
suite "desktop e2e against real Docker ($PROJECT, ports 18480-18485)" desktop_real
if [ -f "$ENV_DIR/backend/.env" ] && [ -f "$ENV_DIR/frontend/.env" ]; then
  suite "hosted preview smoke ($PREVIEW_PROJECT)" hosted_preview
else
  RESULTS+=("hosted preview smoke: skipped (no backend/frontend .env in $ENV_DIR)")
fi

echo "make test-e2e: results"
failed=0
for r in "${RESULTS[@]}"; do
  echo "  $r"
  case "$r" in *FAIL*) failed=1 ;; esac
done
exit "$failed"
