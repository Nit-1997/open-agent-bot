#!/usr/bin/env bash
set -euo pipefail

DOCKER=0
HOSTED_FREE=0
for arg in "$@"; do
  case "$arg" in
    --docker) DOCKER=1 ;;
    --hosted-free) HOSTED_FREE=1 ;;
    *) echo "standalone: refused: unknown argument '$arg' (usage: standalone.sh [--docker] [--hosted-free])" >&2; exit 2 ;;
  esac
done

refuse() {
  echo "standalone: refused: $*" >&2
  exit 2
}

real() { (cd -P -- "$1" 2>/dev/null && pwd -P); }

under() {
  local child="$1" parent="$2"
  [ -n "$parent" ] || return 1
  [ "$child" = "$parent" ] || [ "${child#"$parent"/}" != "$child" ]
}

[ "${OAB_STANDALONE_ALLOW_DELETE:-}" = 1 ] || refuse "set OAB_STANDALONE_ALLOW_DELETE=1; this removes cloud/ from the checkout"

TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || refuse "not inside a git checkout"
TOP_REAL="$(real "$TOP")" || refuse "cannot resolve the checkout path"

if [ "${GITHUB_ACTIONS:-}" = true ]; then
  [ -n "${RUNNER_TEMP:-}" ] || refuse "GITHUB_ACTIONS=true without RUNNER_TEMP"
  [ -n "${GITHUB_WORKSPACE:-}" ] || refuse "GITHUB_ACTIONS=true without GITHUB_WORKSPACE"
  WS_REAL="$(real "$GITHUB_WORKSPACE")" || refuse "GITHUB_WORKSPACE does not exist"
  under "$TOP_REAL" "$WS_REAL" || refuse "the checkout is not under GITHUB_WORKSPACE"
else
  [ -d "$TOP/.git" ] || refuse "not a fresh clone: .git is not a directory (linked worktree?)"
  ok=0
  for t in "${TMPDIR:-}" /tmp /private/tmp; do
    [ -n "$t" ] || continue
    t_real="$(real "$t")" || continue
    if under "$TOP_REAL" "$t_real"; then ok=1; fi
  done
  [ "$ok" = 1 ] || refuse "the checkout is not under \$TMPDIR, /tmp or /private/tmp"
  [ -z "$(git -C "$TOP" status --porcelain)" ] || refuse "the working tree is not clean"
fi

ignored="$(git -C "$TOP" ls-files -o -i --exclude-standard -- cloud)"
[ -z "$ignored" ] || refuse "ignored files under cloud/ would be deleted: $(printf '%s' "$ignored" | tr '\n' ' ')"

if [ "$DOCKER" = 1 ]; then
  P="${OAB_STANDALONE_PROJECT:-}"
  printf '%s' "$P" | grep -Eq '^oab-[a-z0-9][a-z0-9_-]*$' || refuse "OAB_STANDALONE_PROJECT must start with oab-, got '$P'"
  printf '%s' "${OPEN_AGENT_PORT:-}" | grep -Eq '^1[89][0-9]{3}$' || refuse "OPEN_AGENT_PORT must be in 18000-19999, got '${OPEN_AGENT_PORT:-}'"
  [ "${OPEN_AGENT_DATA_VOLUME:-}" = "$P-data" ] || refuse "OPEN_AGENT_DATA_VOLUME must be $P-data"
  [ "${OPEN_AGENT_KEYS_VOLUME:-}" = "$P-keys" ] || refuse "OPEN_AGENT_KEYS_VOLUME must be $P-keys"
  for v in OPEN_AGENT_IMAGE OPEN_AGENT_SEARCH_IMAGE; do
    printf '%s' "${!v:-}" | grep -Eq '^oab-[a-z0-9._/-]+:dev$' || refuse "$v must be an oab-…:dev tag, got '${!v:-}'"
  done
  [ "${APP_ORIGIN:-}" = "http://127.0.0.1:$OPEN_AGENT_PORT" ] || refuse "APP_ORIGIN must be http://127.0.0.1:$OPEN_AGENT_PORT"
fi

cd "$TOP"

step() {
  local name="$1"
  shift
  local rc=0
  "$@" || rc=$?
  echo "[standalone $name] exit $rc"
  [ "$rc" = 0 ] || exit "$rc"
}

only_cloud_deletions() {
  local bad
  bad="$(git status --porcelain | grep -Ev '^D  cloud/' || true)"
  [ -z "$bad" ] || { echo "unexpected changes after git rm:" >&2; printf '%s\n' "$bad" >&2; return 1; }
}

playwright_install() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then npx --no-install playwright install --with-deps chromium; else npx --no-install playwright install chromium; fi
}

hosted_free() {
  test ! -e packages/core/dist/hosted || { echo "packages/core/dist/hosted exists" >&2; return 1; }
  test ! -e packages/core/dist/server.js || { echo "packages/core/dist/server.js exists" >&2; return 1; }
  local rc=0
  grep -rlE '@supabase/|["'\'']jose["'\'']' packages/core/src packages/core/dist || rc=$?
  echo "grep for @supabase/ and jose in packages/core: exit $rc (1 = no match = pass)"
  [ "$rc" = 1 ]
}

export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export COPILOTKIT_TELEMETRY_DISABLED=true

step git-rm git rm -rq --ignore-unmatch cloud
step status only_cloud_deletions
step npm-ci npm ci
step playwright playwright_install
step lint npm run lint
step format npm run format:check
step typecheck npm run typecheck
step test npm test
step build npm run build
step boundary node scripts/boundary/cloud-boundary.mjs
if [ "$HOSTED_FREE" = 1 ]; then step hosted-free hosted_free; fi

if [ "$DOCKER" = 1 ]; then
  C=(docker compose -p "$P" --env-file /dev/null -f docker-compose.yml)
  . scripts/preview-preflight.sh
  step preflight preflight "${C[@]}"
  teardown() {
    "${C[@]}" down -v --remove-orphans || true
    docker volume rm "$OPEN_AGENT_DATA_VOLUME" "$OPEN_AGENT_KEYS_VOLUME" >/dev/null 2>&1 || true
    docker image rm "$OPEN_AGENT_IMAGE" "$OPEN_AGENT_SEARCH_IMAGE" >/dev/null 2>&1 || true
    echo "[standalone teardown] project $P, volumes $OPEN_AGENT_DATA_VOLUME $OPEN_AGENT_KEYS_VOLUME, images $OPEN_AGENT_IMAGE $OPEN_AGENT_SEARCH_IMAGE removed"
  }
  trap teardown EXIT
  names() { "${C[@]}" config --format json | jq -c '{name, volumes: [.volumes[].name]}'; }
  step config names
  step docker-build "${C[@]}" build
  step image-cmd docker image inspect --format '{{json .Config.Cmd}} {{.Config.WorkingDir}}' "$OPEN_AGENT_IMAGE"
  image_tree() {
    local check='test ! -e /app/cloud'
    if [ "$HOSTED_FREE" = 1 ]; then
      check="$check && test ! -e /app/packages/core/dist/hosted && test ! -e /app/packages/core/dist/server.js"
      [ "$(docker image inspect --format '{{json .Config.Cmd}}' "$OPEN_AGENT_IMAGE")" = '["node","dist/local/main.js"]' ] \
        || { echo "agent image Cmd is not [\"node\",\"dist/local/main.js\"]" >&2; return 1; }
    fi
    docker run --rm --pull never --entrypoint sh "$OPEN_AGENT_IMAGE" -c "$check"
  }
  step image-tree image_tree
  step image-content node scripts/release/image-checks.mjs content --image "$OPEN_AGENT_IMAGE" --dir /app
  step up "${C[@]}" up -d --wait --wait-timeout 300
  health() { curl -fsS "$APP_ORIGIN/health" && echo; }
  step health health
  step probes npx --no-install tsx e2e/scripts/local-probes.mts
  trap - EXIT
  step teardown teardown
fi

desktop() {
  local tmp rc=0
  tmp="$(mktemp -d)"
  chmod 700 "$tmp"
  TMPDIR="$tmp" npm run build -w @oab/desktop && TMPDIR="$tmp" npm run stage -w @oab/desktop || rc=$?
  rm -rf "$tmp"
  return "$rc"
}
step desktop desktop
echo "standalone: ok"
