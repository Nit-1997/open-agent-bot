#!/usr/bin/env bash
set -u
set -o pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO" || exit 1
. "$REPO/scripts/preview-preflight.sh"

PART="$(basename "$0" .sh)"
DEMO_DIR="${DEMO_DIR:-.factory/m6/demo}"
EXITS="$DEMO_DIR/exit-codes.txt"
BUSYBOX="busybox:1.37@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec"
LIVE_SHA=c1c0f4e
M3_SHA=4879d41
export COPILOTKIT_TELEMETRY_DISABLED=true ELECTRON_SKIP_BINARY_DOWNLOAD=1

require_oab() {
  local n
  for n in "$@"; do
    [[ "$n" =~ ^oab-[a-z0-9-]+$ ]] || { echo "ABORT: '$n' is not an oab- name" >&2; exit 1; }
  done
}
require_oab_ref() {
  [[ "${1:-}" =~ ^oab-[a-z0-9._-]+(:[A-Za-z0-9._-]+)?$ ]] && return 0
  echo "ABORT: '${1:-}' is not an oab- container or image" >&2
  return 1
}
require_under_factory() {
  local d
  for d in "$@"; do
    case "$d" in
      .factory/m6/*) [[ "$d" != *..* ]] || { echo "ABORT: '$d' must not contain .." >&2; exit 1; } ;;
      *) echo "ABORT: '$d' must be a relative path under .factory/m6/" >&2; exit 1 ;;
    esac
  done
}
require_oab oab-factory-m6-oss oab-factory-m6-hosted oab-factory-m6-gate7 oab-factory-m6-ctx
require_under_factory "$DEMO_DIR"
mkdir -p "$DEMO_DIR"
[ -f "$EXITS" ] || printf 'time\tpart\tstep\texit\tmeaning\n' > "$EXITS"

step() { printf '\n\033[1m== %s · %s ==\033[0m\n' "$PART" "$*"; }
note() { printf '   %s\n' "$*"; }
record() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%H:%M:%S)" "$PART" "$1" "$2" "$3" >> "$EXITS"; }

run() {
  local label="$1" cmd="$2" rc
  printf '\033[36m$ %s\033[0m\n' "$cmd"
  (eval "$cmd")
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

attempt() {
  local label="$1" meaning="$2" cmd="$3" rc
  printf '\033[36m$ %s\033[0m\n' "$cmd"
  (eval "$cmd")
  rc=$?
  if [ "$rc" -eq 0 ]; then
    record "$label" 0 ""
    printf '   [%s exit 0]\n' "$label"
    return 0
  fi
  record "$label" "$rc" "$meaning"
  printf '\033[33m   [%s exit %s = %s]\033[0m\n' "$label" "$rc" "$meaning"
  return "$rc"
}

exits() {
  local label="$1" want="$2" meaning="$3" cmd="$4" rc
  printf '\033[36m$ %s\033[0m\n' "$cmd"
  (eval "$cmd")
  rc=$?
  if [ "$rc" -eq "$want" ]; then
    record "$label" "$rc" "$meaning"
    printf '\033[33m   [%s exit %s = %s]\033[0m\n' "$label" "$rc" "$meaning"
    return 0
  fi
  record "$label" "$rc" "UNEXPECTED: $label exited $rc, expected $want; $PART stopped"
  printf '\033[31m!! %s exited %s, expected %s; %s stops here\033[0m\n' "$label" "$rc" "$want" "$PART"
  exit 1
}

absent() { exits "$1" 1 "$2" "$3"; }

need() {
  local label="$1" refusal="$2" cmd="$3"
  printf '\033[36m$ %s\033[0m\n' "$cmd"
  if (eval "$cmd"); then
    record "$label" 0 ""
    printf '   [%s exit 0]\n' "$label"
    return 0
  fi
  record "$label" 1 "REFUSED: $refusal; $PART stopped"
  printf '\033[31m!! %s refused: %s; %s stops here\033[0m\n' "$label" "$refusal" "$PART"
  exit 1
}

no_open_agent_project() {
  if docker compose ls -a --format json | jq -r '.[].Name' | grep -qx open-agent; then
    record no-open-agent-project 1 "ABORT: a real open-agent compose project exists"
    echo "ABORT: a real open-agent project exists"
    exit 1
  fi
  record no-open-agent-project 0 ""
  note "no open-agent compose project"
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
scratch() {
  local d
  d="$(mktemp -d "${TMPDIR:-/tmp}/oab-m6-$1.XXXXXX")" && d="$(realpath "$d")" || exit 1
  remember "scratch-$1" "$d"
  printf '%s' "$d"
}
forget_scratch() {
  local f d
  for f in "$DEMO_DIR"/scratch-*.path; do
    [ -e "$f" ] || continue
    if [ -d "$(cat "$f")" ]; then
      d="$(recall "$(basename "$f" .path)")" && rm -rf "$d" && note "removed $d"
    fi
    rm -f "$f"
  done
  rm -f "$DEMO_DIR/m6-clone.path"
}
clone_at() { git clone -q --no-checkout "file://$REPO" "$2" && git -C "$2" checkout -q "$1" && git -C "$2" log --oneline -1; }

jq_names() { jq '{name, volumes: [.volumes[].name]}'; }
jq_names_ports() { jq '{name, volumes: [.volumes[].name], ports: [.services[].ports[]? | "\(.host_ip):\(.published)"]}'; }

inspect_oab() {
  require_oab_ref "$2" || return 1
  docker inspect --format "$1" "$2"
}
image_inspect_oab() {
  require_oab_ref "$2" || return 1
  docker image inspect --format "$1" "$2"
}
m6_images() { docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^oab-factory-m6-'; }
rm_m6_images() { [ -z "$(m6_images)" ] || docker image rm $(m6_images); }
hosted_containers() { docker ps -a --filter label=com.docker.compose.project=oab-factory-m6-hosted --format '{{.Names}}' | sort; }

old_compose() {
  local old="$1" file="$2" m6="$3"
  shift 3
  docker compose -p oab-factory-m6-hosted -f "$old/$file" -f "$m6/cloud/deploy/compose.preview.yml" \
    --env-file "$old/deploy-config/.env-nextjs" --profile local "$@"
}
new_compose() {
  local m6="$1"
  shift
  docker compose -p oab-factory-m6-hosted -f "$m6/cloud/deploy/compose.hosted.yml" -f "$m6/cloud/deploy/compose.preview.yml" \
    --env-file "$m6/cloud/deploy/.env-nextjs" --profile local "$@"
}
gate7_compose() {
  local m6="$1"
  shift
  docker compose -p oab-factory-m6-gate7 -f "$m6/cloud/deploy/compose.hosted.yml" -f "$m6/cloud/deploy/compose.preview.yml" \
    --env-file "$m6/cloud/deploy/.env-nextjs" --profile local "$@"
}
gate7_config_check() {
  preflight gate7_compose "$1" || return 1
  gate7_compose "$1" run --rm --no-deps --build agent node -e "import('./dist/config.js').then(m=>{try{m.loadHostedConfig(process.env);console.log('hosted config ok')}catch(e){console.log(e.name==='ConfigError'?e.message:e.name+' '+(e.code??''));process.exit(1)}})"
}

place_old_env() {
  local old="$1" f
  for f in .env-agent .env-renderer .env-nextjs; do
    install -m 600 "$REPO/cloud/deploy/$f" "$old/deploy-config/$f" || return 1
  done
  stat -f '%Sp %N' "$old"/deploy-config/.env-* | sed "s|$old/||"
}

hosted_facts() {
  local tag="$1" c svc
  hosted_containers > "$DEMO_DIR/$tag-names.txt"
  docker ps -a --filter label=com.docker.compose.project=oab-factory-m6-hosted --format '{{.Names}} {{.Image}} {{.CreatedAt}} {{.Status}}' \
    | sort | tee "$DEMO_DIR/$tag-containers.txt"
  docker volume ls --filter label=com.docker.compose.project=oab-factory-m6-hosted --format '{{.Name}}' | sort \
    | tee "$DEMO_DIR/$tag-volumes.txt"
  docker run --rm -v oab-factory-m6-hosted_searxng-data:/v:ro "$BUSYBOX" find /v -type f -exec sha256sum {} + \
    | tee "$DEMO_DIR/$tag-secret.txt" || return 1
  : > "$DEMO_DIR/$tag-mounts.txt"
  while read -r c; do
    inspect_oab '{{.Name}}: {{range .Mounts}}{{if eq .Type "bind"}}{{.Source}} -> {{.Destination}} {{end}}{{end}}' "$c" \
      | tee -a "$DEMO_DIR/$tag-mounts.txt" || return 1
  done < "$DEMO_DIR/$tag-names.txt"
  : > "$DEMO_DIR/$tag-images.txt"
  for svc in agent renderer web; do
    printf '%s %s\n' "$svc" "$(image_inspect_oab '{{.Id}}' "oab-factory-m6-hosted-$svc")" | tee -a "$DEMO_DIR/$tag-images.txt"
  done
}

compare_facts() {
  local a="$1" b="$2" moved="$3" same_images="$4"
  diff "$DEMO_DIR/$a-names.txt" "$DEMO_DIR/$b-names.txt" && note "same containers"
  diff "$DEMO_DIR/$a-volumes.txt" "$DEMO_DIR/$b-volumes.txt" && note "same volumes" || return 1
  diff "$DEMO_DIR/$a-secret.txt" "$DEMO_DIR/$b-secret.txt" && note "same SearXNG secret file hash" || return 1
  join <(awk '{print $1, $3, $4}' "$DEMO_DIR/$a-containers.txt") <(awk '{print $1, $3, $4}' "$DEMO_DIR/$b-containers.txt") \
    | awk '{ if ($2" "$3 == $4" "$5) { print "NOT RECREATED " $1; bad = 1 } else print "recreated " $1 } END { exit bad }' || return 1
  grep -E "$moved" "$DEMO_DIR/$b-mounts.txt" > /dev/null && note "bind sources now under $moved" || return 1
  if [ "$same_images" = same ]; then
    diff "$DEMO_DIR/$a-images.txt" "$DEMO_DIR/$b-images.txt" && note "the same image ids as before the switch"
  else
    ! diff -q "$DEMO_DIR/$a-images.txt" "$DEMO_DIR/$b-images.txt" > /dev/null && note "new image ids for agent, renderer and web"
  fi
}

retag_rollback() {
  local sha="$1" svc img n=0
  : > "$DEMO_DIR/rollback-$sha.txt"
  while read -r svc img; do
    case "$svc" in agent | renderer | web) ;; *) continue ;; esac
    require_oab_ref "$img" || return 1
    docker tag "$img" "${img%:*}:rollback-$sha" || return 1
    printf '%s %s %s:rollback-%s\n' "$svc" "$img" "${img%:*}" "$sha" | tee -a "$DEMO_DIR/rollback-$sha.txt"
    n=$((n + 1))
  done < <(docker ps --filter label=com.docker.compose.project=oab-factory-m6-hosted --format '{{.Label "com.docker.compose.service"}} {{.Image}}')
  [ "$n" -eq 3 ] || { echo "expected 3 built services, tagged $n" >&2; return 1; }
}
retag_back() {
  local svc img tag
  while read -r svc img tag; do
    require_oab_ref "$img" || return 1
    docker tag "$tag" "$img" && note "$tag -> $img ($svc)" || return 1
  done < "$DEMO_DIR/rollback-$1.txt"
}

secret_patterns() {
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?[A-Za-z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|SERVICE)[A-Za-z0-9_]*=//p' "$@" \
    | sed -E "s/^[\"']//; s/[\"'][[:space:]]*$//; s/[[:space:]]+$//" | awk 'length >= 12'
}

down_hosted() {
  preflight docker compose -p oab-factory-m6-hosted -f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --env-file /dev/null --profile local || return 1
  docker compose -p oab-factory-m6-hosted -f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --env-file /dev/null --profile local down -v --remove-orphans
}
down_gate7() {
  preflight docker compose -p oab-factory-m6-gate7 -f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --env-file /dev/null --profile local || return 1
  docker compose -p oab-factory-m6-gate7 -f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --env-file /dev/null --profile local down -v --remove-orphans
}
down_oss() {
  OPEN_AGENT_DATA_VOLUME=oab-factory-m6-oss-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m6-oss-keys OPEN_AGENT_PORT=18610 \
    preflight docker compose -p oab-factory-m6-oss -f docker-compose.yml --env-file /dev/null || return 1
  OPEN_AGENT_DATA_VOLUME=oab-factory-m6-oss-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m6-oss-keys OPEN_AGENT_PORT=18610 \
    docker compose -p oab-factory-m6-oss -f docker-compose.yml --env-file /dev/null down -v --remove-orphans
}
