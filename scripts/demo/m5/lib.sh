#!/usr/bin/env bash
set -u
set -o pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO" || exit 1
. "$REPO/scripts/preview-preflight.sh"

PART="$(basename "$0" .sh)"
DEMO_DIR="${DEMO_DIR:-.factory/m5/demo}"
DRY="${DEMO_DRY_ROOT:-.factory/m5/release-dry-run}"
V1="${DEMO_VERSION_A:-0.0.0-dryrun.1}"
V2="${DEMO_VERSION_B:-0.0.0-dryrun.2}"
DOCKER_CLI="${DEMO_DOCKER:-/usr/local/bin/docker}"
REGISTRY_IMAGE="registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373"
EXITS="$DEMO_DIR/exit-codes.txt"
export OPEN_AGENT_SHELL_TEST=1 COPILOTKIT_TELEMETRY_DISABLED=true

require_oab() {
  local n
  for n in "$@"; do
    [[ "$n" =~ ^oab-[a-z0-9-]+$ ]] || { echo "ABORT: '$n' is not an oab- name" >&2; exit 1; }
  done
}
require_under_factory() {
  local d
  for d in "$@"; do
    case "$d" in
      .factory/m5/*) [[ "$d" != *..* ]] || { echo "ABORT: '$d' must not contain .." >&2; exit 1; } ;;
      *) echo "ABORT: '$d' must be a relative path under .factory/m5/" >&2; exit 1 ;;
    esac
  done
}
require_oab oab-factory-m5-registry oab-factory-m5-builder oab-factory-m5-pkg oab-factory-m5-demo oab-factory-m5-clone \
  oab-m5-open-agent oab-m5-open-agent-search
require_under_factory "$DEMO_DIR" "$DRY"
[[ "$V1" =~ ^0\.0\.0-dryrun\.[0-9]+$ && "$V2" =~ ^0\.0\.0-dryrun\.[0-9]+$ ]] || { echo "ABORT: versions must be 0.0.0-dryrun.N" >&2; exit 1; }
mkdir -p "$DEMO_DIR"
[ -f "$EXITS" ] || printf 'time\tpart\tstep\texit\tmeaning\n' > "$EXITS"

step() { printf '\n\033[1m== %s · %s ==\033[0m\n' "$PART" "$*"; }
note() { printf '   %s\n' "$*"; }
record() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%H:%M:%S)" "$PART" "$1" "$2" "$3" >> "$EXITS"; }

run() {
  local label="$1" cmd="$2" rc
  printf '\033[36m$ %s\033[0m\n' "$cmd"
  eval "$cmd"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    record "$label" 0 ""
    printf '   [%s exit 0]\n' "$label"
    return 0
  fi
  record "$label" "$rc" "UNEXPECTED: $label failed; $PART stopped"
  printf '\033[31m!! %s exited %s (unexpected); %s stops here\033[0m\n' "$label" "$rc" "$PART"
  exit "$rc"
}

expect() {
  local label="$1" meanings="$2" cmd="$3" rc entry meaning=""
  printf '\033[36m$ %s\033[0m\n' "$cmd"
  eval "$cmd"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    record "$label" 0 ""
    printf '   [%s exit 0]\n' "$label"
    return 0
  fi
  IFS='|' read -r -a entries <<< "$meanings"
  for entry in "${entries[@]}"; do
    [ "${entry%%=*}" = "$rc" ] && meaning="${entry#*=}"
  done
  if [ -n "$meaning" ]; then
    record "$label" "$rc" "$meaning"
    printf '\033[33m   [%s exit %s = %s]\033[0m\n' "$label" "$rc" "$meaning"
    return 0
  fi
  record "$label" "$rc" "UNEXPECTED: $label failed; $PART stopped"
  printf '\033[31m!! %s exited %s (unexpected); %s stops here\033[0m\n' "$label" "$rc" "$PART"
  exit "$rc"
}

absent() {
  local label="$1" meaning="$2" cmd="$3" rc
  printf '\033[36m$ %s\033[0m\n' "$cmd"
  eval "$cmd"
  rc=$?
  if [ "$rc" -eq 1 ]; then
    record "$label" 1 "$meaning"
    printf '\033[33m   [%s exit 1 = %s]\033[0m\n' "$label" "$meaning"
    return 0
  fi
  record "$label" "$rc" "UNEXPECTED: $label found something (or failed); $PART stopped"
  printf '\033[31m!! %s exited %s: expected nothing to be found; %s stops here\033[0m\n' "$label" "$rc" "$PART"
  exit 1
}

remember() { printf '%s\n' "$2" > "$DEMO_DIR/$1.path"; }
recall() {
  local p real root
  p="$(cat "$DEMO_DIR/$1.path" 2>/dev/null)" || { echo "ABORT: $1 is unknown; run its part first" >&2; exit 1; }
  case "$p" in
    *..*) echo "ABORT: $1 path '$p' contains .." >&2; exit 1 ;;
  esac
  [ -d "$p" ] || { echo "ABORT: $1 path '$p' is not a directory" >&2; exit 1; }
  real="$(realpath "$p")" || { echo "ABORT: $1 path '$p' does not resolve" >&2; exit 1; }
  for root in "${TMPDIR:-/tmp}" /tmp "$DEMO_DIR"; do
    root="$(realpath "$root" 2>/dev/null)" || continue
    case "$real" in
      "${root%/}"/?*) printf '%s' "$real"; return 0 ;;
    esac
  done
  echo "ABORT: $1 path '$p' resolves to '$real', outside \$TMPDIR and $DEMO_DIR" >&2
  exit 1
}

down_pkg() {
  OPEN_AGENT_DATA_VOLUME=oab-factory-m5-pkg-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m5-pkg-keys OPEN_AGENT_PORT=18510 \
    preflight docker compose -p oab-factory-m5-pkg -f docker-compose.yml --env-file /dev/null || return 1
  OPEN_AGENT_DATA_VOLUME=oab-factory-m5-pkg-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m5-pkg-keys OPEN_AGENT_PORT=18510 \
    docker compose -p oab-factory-m5-pkg -f docker-compose.yml --env-file /dev/null down -v --remove-orphans
}
down_demo() {
  OPEN_AGENT_DATA_VOLUME=oab-factory-m5-demo-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m5-demo-keys OPEN_AGENT_PORT=18515 \
    preflight docker compose -p oab-factory-m5-demo -f docker-compose.yml --env-file /dev/null || return 1
  OPEN_AGENT_DATA_VOLUME=oab-factory-m5-demo-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m5-demo-keys OPEN_AGENT_PORT=18515 \
    docker compose -p oab-factory-m5-demo -f docker-compose.yml --env-file /dev/null down -v --remove-orphans
}
down_clone() {
  OPEN_AGENT_DATA_VOLUME=oab-factory-m5-clone-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m5-clone-keys OPEN_AGENT_PORT=18520 \
    preflight docker compose -p oab-factory-m5-clone -f docker-compose.yml --env-file /dev/null || return 1
  OPEN_AGENT_DATA_VOLUME=oab-factory-m5-clone-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m5-clone-keys OPEN_AGENT_PORT=18520 \
    docker compose -p oab-factory-m5-clone -f docker-compose.yml --env-file /dev/null down -v --remove-orphans
}
m5_images() { docker image ls -a --digests --format '{{.Repository}}@{{.Digest}}' | grep -E '(^|/)oab-m5-' | grep -v '@<none>$'; }
