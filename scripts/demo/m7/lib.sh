#!/usr/bin/env bash
set -u
set -o pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO" || exit 1
. "$REPO/scripts/preview-preflight.sh"

PART="$(basename "$0" .sh)"
DEMO_DIR="${DEMO_DIR:-.factory/m7/demo}"
EXITS="$DEMO_DIR/exit-codes.txt"
APP=http://localhost:18721
AGENT=http://127.0.0.1:18720
STUB=http://127.0.0.1:18722
PORTS_USED="18720 18721 18722"
TURNSTILE_SITE_PASS=1x00000000000000000000AA
TURNSTILE_PASS=1x0000000000000000000000000000000AA
TURNSTILE_FAIL=2x0000000000000000000000000000000AA
export COPILOTKIT_TELEMETRY_DISABLED=true NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 GIT_PAGER=cat PAGER=cat

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
      .factory/m7/*) [[ "$d" != *..* ]] || { echo "ABORT: '$d' must not contain .." >&2; exit 1; } ;;
      *) echo "ABORT: '$d' must be a relative path under .factory/m7/" >&2; exit 1 ;;
    esac
  done
}
require_oab oab-m7-demo oab-m7-g8
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

safety_lines() {
  note "The only Supabase instances are oab-m7-demo and oab-m7-g8 on 127.0.0.1."
  note "No Supabase link, config push or linked flag, and no migration push except to a 127.0.0.1 --db-url."
  note "No production settings file is read; every secret is generated for this run."
  note "No live container is touched (only the docker ps name list)."
  note "No screen capture: terminal parts under the pty recorder, browser parts with Playwright video."
  note "Every non-zero exit is named and explained (exit-codes.txt)."
}

refuse_supabase_env() {
  local n
  for n in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD SUPABASE_DB_URL LIVE_DB_URL; do
    if [ -n "${!n:-}" ]; then
      record refuse-supabase-env 1 "ABORT: $n is set"
      echo "ABORT: $n is set in this shell; unset it before the M7 demo"
      exit 1
    fi
  done
  note "no Supabase access token, project ref, database password or URL in the environment"
}

memory_check() {
  local bytes min=$((6 * 1024 * 1024 * 1024))
  bytes="$(docker info --format '{{.MemTotal}}')" || { echo "ABORT: docker info failed"; exit 1; }
  if [ "$bytes" -ge "$min" ]; then
    M7_MODE=together
    note "Docker memory $((bytes / 1024 / 1024)) MiB: oab-m7-demo and oab-m7-g8 can run together"
  elif [ "${M7_DEMO_SEQUENTIAL:-}" = 1 ]; then
    M7_MODE=sequential
    note "Docker memory $((bytes / 1024 / 1024)) MiB, below 6 GiB: M7_DEMO_SEQUENTIAL=1 stops oab-m7-demo while oab-m7-g8 runs"
  else
    record memory-check 1 "REFUSED: Docker memory below 6 GiB"
    echo "REFUSED: Docker has $((bytes / 1024 / 1024)) MiB; two stacks need about 6 GiB. Raise it, or rerun with M7_DEMO_SEQUENTIAL=1"
    exit 1
  fi
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

live_snapshot() {
  docker ps --format '{{.Names}} {{.State}} {{.CreatedAt}}' | grep -E '^open-agent-bot' | sort > "$DEMO_DIR/live-$1.txt"
  cat "$DEMO_DIR/live-$1.txt"
}

remember() { printf '%s\n' "$2" > "$DEMO_DIR/$1.path"; }
recall() {
  local p real root
  p="$(cat "$DEMO_DIR/$1.path" 2>/dev/null)" || { echo "ABORT: $1 is unknown; run part 0 first" >&2; exit 1; }
  case "$p" in
    *..*) echo "ABORT: $1 path '$p' contains .." >&2; exit 1 ;;
  esac
  [ -d "$p" ] || { echo "ABORT: $1 path '$p' is not a directory" >&2; exit 1; }
  real="$(realpath "$p")" || { echo "ABORT: $1 path '$p' does not resolve" >&2; exit 1; }
  for root in "${TMPDIR:-/tmp}" /tmp; do
    root="$(realpath "$root" 2>/dev/null)" || continue
    case "$real" in
      "${root%/}"/?*) printf '%s' "$real"; return 0 ;;
    esac
  done
  echo "ABORT: $1 path '$p' resolves to '$real', outside \$TMPDIR" >&2
  exit 1
}

demo_env_secrets() {
  local d
  d="$(mktemp -d "${TMPDIR:-/tmp}/oab-m7-demo-run.XXXXXX")" && d="$(realpath "$d")" || exit 1
  chmod 700 "$d" || exit 1
  remember run "$d"
  (
    umask 077
    {
      printf 'SVC_SECRET=%s\n' "$(openssl rand -hex 32)"
      printf 'RENDERER_SECRET=%s\n' "$(openssl rand -hex 32)"
      printf 'CREDENTIAL_KEYS=v1:%s\n' "$(openssl rand -base64 32)"
      printf 'ACCESS_REQUEST_PEPPER=%s\n' "$(openssl rand -base64 32)"
    } > "$d/secrets.env"
  ) || exit 1
  note "fresh service, credential, pepper and renderer secrets in a 0700 run folder (values never printed); the Turnstile keys are Cloudflare's public test keys"
}

demo_env_stack() {
  local d
  d="$(recall run)" || exit 1
  (umask 077 && node cloud/supabase/scripts/local-stack.mjs env --name oab-m7-demo > "$d/stack.env") || return 1
  note "local stack values for oab-m7-demo written to the run folder ($(grep -c '^export OAB_SB_' "$d/stack.env") names)"
}

load_run_env() {
  local d
  d="$(recall run)" || exit 1
  [ -f "$d/stack.env" ] && [ -f "$d/secrets.env" ] || { echo "ABORT: the run folder is incomplete; run part 0 first" >&2; exit 1; }
  . "$d/stack.env"
  . "$d/secrets.env"
  RUN="$d"
}

secret_patterns() {
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?[A-Za-z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PEPPER)[A-Za-z0-9_]*=//p' "$@" \
    | sed -E "s/^[\"']//; s/[\"'][[:space:]]*$//; s/[[:space:]]+$//; s/^v1://" | awk 'length >= 12'
}

stack_start() {
  local until
  case "$1" in
    oab-m7-demo) node cloud/supabase/scripts/local-stack.mjs start --name oab-m7-demo --ports 18700 --site-url "$APP" ;;
    oab-m7-g8)
      until="$(node cloud/supabase/scripts/check-push-plan.mjs --pre-m7-versions | awk '{ print $NF }')" || return 1
      note "oab-m7-g8 starts at the last pre-M7 migration $until"
      node cloud/supabase/scripts/local-stack.mjs start --name oab-m7-g8 --ports 18710 --migrations-until "$until" --site-url "$APP"
      ;;
    *) echo "ABORT: unknown stack $1" >&2; return 1 ;;
  esac
}
stack_stop() {
  if ! docker ps -a --format '{{.Names}}' | grep -q "_$1\$"; then
    note "$1 is not running; nothing to stop"
    return 0
  fi
  case "$1" in
    oab-m7-demo) node cloud/supabase/scripts/local-stack.mjs stop --name oab-m7-demo --ports 18700 ;;
    oab-m7-g8) node cloud/supabase/scripts/local-stack.mjs stop --name oab-m7-g8 --ports 18710 ;;
    *) echo "ABORT: unknown stack $1" >&2; return 1 ;;
  esac
}
stack_bindings() { docker ps --filter name=_oab-m7- --format '{{.Names}} {{.Ports}}' | sort; }
m7_leftovers() {
  { docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker network ls --format '{{.Name}}'; } | grep -E '_oab-m7-(demo|g8)$'
}

psql_demo() { psql "postgresql://postgres:postgres@127.0.0.1:18702/postgres" -X -v ON_ERROR_STOP=1 "$@"; }
psql_g8() { psql "postgresql://postgres:postgres@127.0.0.1:18712/postgres" -X -v ON_ERROR_STOP=1 "$@"; }
repair_g8() {
  local had=0 rc
  [ -e cloud/supabase/.temp ] && had=1
  supabase --workdir cloud migration repair --status applied "$@" --db-url "postgresql://postgres:postgres@127.0.0.1:18712/postgres?sslmode=disable"
  rc=$?
  [ "$had" = 1 ] || rm -rf cloud/supabase/.temp
  return "$rc"
}
g8_bodies() { psql_g8 -XAtc "$(node cloud/supabase/scripts/check-old-bodies.mjs --query)" | node cloud/supabase/scripts/check-old-bodies.mjs; }

wait_port() {
  local i
  for i in $(seq 1 240); do
    nc -z 127.0.0.1 "$1" 2> /dev/null && return 0
    sleep 0.5
  done
  echo "port $1 never opened" >&2
  return 1
}

start_bg() {
  local name="$1" port="$2" dir="$3" d
  shift 3
  d="$(recall run)" || exit 1
  stop_bg "$name"
  printf '== %s %s start\n' "$(date +%H:%M:%S)" "$name" >> "$DEMO_DIR/$name.log"
  (
    cd "$dir" || exit 1
    nohup env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" "$@" >> "$REPO/$DEMO_DIR/$name.log" 2>&1 &
    echo $! > "$d/$name.pid"
  )
  wait_port "$port"
}
stop_bg() {
  local d f p i
  d="$(recall run)" || exit 1
  f="$d/$1.pid"
  [ -f "$f" ] || return 0
  p="$(cat "$f")"
  pkill -TERM -P "$p" 2> /dev/null
  kill "$p" 2> /dev/null
  for i in $(seq 1 40); do
    kill -0 "$p" 2> /dev/null || break
    sleep 0.25
  done
  pkill -KILL -P "$p" 2> /dev/null
  kill -9 "$p" 2> /dev/null
  rm -f "$f"
}
stop_all() {
  local n
  for n in web agent stub; do stop_bg "$n"; done
}
no_background() {
  local p left=0 d
  d="$(recall run)" || exit 1
  for p in $PORTS_USED; do
    if nc -z 127.0.0.1 "$p" 2> /dev/null; then
      echo "still listening on $p"
      left=1
    fi
  done
  ls "$d"/*.pid 2> /dev/null && left=1
  [ "$left" -eq 0 ] && note "no demo process left (ports $PORTS_USED closed, no pid files)"
  record no-background "$left" "$([ "$left" -eq 0 ] || echo 'UNEXPECTED: a demo process is still running')"
  return "$left"
}

agent_env() {
  local running="$1" hour="$2" month="$3" server="$4" turnstile="${5:-}"
  load_run_env
  AGENT_ENV=(SUPABASE_URL="$OAB_SB_API_URL" SUPABASE_PUBLISHABLE_KEY="$OAB_SB_PUBLISHABLE_KEY" SUPABASE_SECRET_KEY="$OAB_SB_SECRET_KEY"
    AGENT_SERVICE_SECRET="$SVC_SECRET" CREDENTIAL_KEYS="$CREDENTIAL_KEYS" ACCESS_REQUEST_PEPPER="$ACCESS_REQUEST_PEPPER"
    RENDERER_SECRET="$RENDERER_SECRET" APP_ORIGIN="$APP" AGENT_PORT=18720 RENDERER_URL=http://127.0.0.1:18725
    SEARXNG_URL=http://127.0.0.1:18724 COPILOTKIT_TELEMETRY_DISABLED=true LOG_LEVEL=info LIMIT_RUNNING_PER_USER="$running"
    LIMIT_REQUESTS_PER_HOUR="$hour" LIMIT_REQUESTS_PER_MONTH="$month" LIMIT_RUNNING_SERVER="$server")
  [ -z "$turnstile" ] || AGENT_ENV+=(TURNSTILE_SECRET_KEY="$turnstile")
  note "agent: LIMIT_RUNNING_PER_USER=$running LIMIT_REQUESTS_PER_HOUR=$hour LIMIT_REQUESTS_PER_MONTH=$month LIMIT_RUNNING_SERVER=$server TURNSTILE_SECRET_KEY=${turnstile:-<unset>}"
}
agent_up() {
  agent_env "$@"
  start_bg agent 18720 "$REPO" SUPABASE_LOCAL_STACK=1 "${AGENT_ENV[@]}" node cloud/agent/dist/server.js
}
agent_check() {
  local mode="$1" pid i rc
  shift
  agent_env "$@"
  [ "$mode" = local ] && AGENT_ENV+=(SUPABASE_LOCAL_STACK=1)
  note "one start of the agent ($mode mode); it is stopped again as soon as it listens"
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" "${AGENT_ENV[@]}" node cloud/agent/dist/server.js > "$DEMO_DIR/startup-check.log" 2>&1 &
  pid=$!
  for i in $(seq 1 60); do
    kill -0 "$pid" 2> /dev/null || break
    if nc -z 127.0.0.1 18720 2> /dev/null; then
      kill "$pid"
      wait "$pid"
      grep -E '^\[|limits' "$DEMO_DIR/startup-check.log" | tail -n 3
      echo "the agent started (port 18720 opened), stopped again"
      return 0
    fi
    sleep 0.5
  done
  wait "$pid"
  rc=$?
  tail -n 3 "$DEMO_DIR/startup-check.log"
  return "$rc"
}
web_build() {
  load_run_env
  (cd cloud/web && env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SUPABASE_URL="$OAB_SB_API_URL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$OAB_SB_PUBLISHABLE_KEY" \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY="$TURNSTILE_SITE_PASS" "$REPO/node_modules/.bin/next" build) > "$DEMO_DIR/web-build.log" 2>&1
}
web_up() {
  load_run_env
  start_bg web 18721 "$REPO/cloud/web" APP_ORIGIN="$APP" AGENT_URL="$AGENT" AGENT_SERVICE_SECRET="$SVC_SECRET" \
    NEXT_PUBLIC_SUPABASE_URL="$OAB_SB_API_URL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$OAB_SB_PUBLISHABLE_KEY" \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY="$TURNSTILE_SITE_PASS" NEXT_TELEMETRY_DISABLED=1 "$REPO/node_modules/.bin/next" start -p 18721
}
stub_up() { start_bg stub 18722 "$REPO" STUB_PORT=18722 ./node_modules/.bin/tsx e2e/support/stubModel.ts; }

with_stack_env() {
  load_run_env
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" DEMO_DIR="$DEMO_DIR" OAB_SB_API_URL="$OAB_SB_API_URL" \
    OAB_SB_DB_URL="$OAB_SB_DB_URL" OAB_SB_SECRET_KEY="$OAB_SB_SECRET_KEY" "$@"
}
users() { with_stack_env node scripts/demo/m7/users.mjs "$@"; }
browser() { with_stack_env node scripts/demo/m7/browser.mjs "$@" 2>&1 | tee -a "$DEMO_DIR/browser.log"; }

evidence() { find "$DEMO_DIR" -type f ! -name '*.webm' ! -name '*.png' 2> /dev/null; }
scan_text() { evidence | while read -r f; do cat "$f"; done; }
request_logs() { find "$DEMO_DIR" -type f \( -name 'agent*.log' -o -name 'web.log' -o -name 'browser.log' -o -name '*.har' \) 2> /dev/null; }
supabase_hosts() { request_logs | while read -r f; do cat "$f"; done | grep -E -c '[.]supabase[.]co([^a-z]|$)|api[.]supabase[.]com'; }
local_web_copy() {
  grep -rlE "requests used|Run it on your Mac|One quick check|Delete my account|DRAFT-NOT-REVIEWED|Requests open again" packages/local-web/dist
}
