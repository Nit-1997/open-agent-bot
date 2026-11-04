#!/usr/bin/env bash
set -eEuo pipefail
. "$(dirname "$0")/lib.sh"

WL_NAME=oab-m7-dev
WL_BASE=18700
WL_AGENT=18720
WL_WEB=18721
WL_STUB=18722
WL_MAIL=$((WL_BASE + 4))
WL_APP="http://localhost:$WL_WEB"
WL_ADMIN=owner@local.test
WL_MEMBER=member@local.test
WL_STUB_KEY=oab-e2e-stub-key
WL_PROCS=(web agent stub)
WL_DIR="${WEB_LOCAL_DIR:-$PWD/.web-local}"
export COPILOTKIT_TELEMETRY_DISABLED=true NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1

say() { echo "make web-local: $*"; }
die() {
  echo "make web-local: $*" >&2
  exit 1
}

case "$WL_DIR" in
  /*) ;;
  *) die "WEB_LOCAL_DIR must be an absolute path (got '$WL_DIR')" ;;
esac

wl_env() {
  clean_env
  CLEAN_ENV+=(TMPDIR="${TMPDIR:-/tmp}" COPILOTKIT_TELEMETRY_DISABLED=true NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1)
}

port_busy() { (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null; }

kill_tree() {
  local c
  for c in $(pgrep -P "$1" 2> /dev/null || true); do kill_tree "$c"; done
  kill "$1" 2> /dev/null || true
}

stop_proc() {
  local f="$WL_DIR/$1.pid" p i
  [ -f "$f" ] || return 0
  p="$(cat "$f")"
  if [[ "$p" =~ ^[0-9]+$ ]] && kill -0 "$p" 2> /dev/null; then
    kill_tree "$p"
    for i in $(seq 1 40); do
      kill -0 "$p" 2> /dev/null || break
      sleep 0.25
    done
    kill -9 "$p" 2> /dev/null || true
    echo "make stop: stopped web-local's $1 (pid $p)"
  fi
  rm -f "$f"
}

stack_leftovers() {
  { docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker network ls --format '{{.Name}}'; } | grep -E "_${WL_NAME}\$" || true
}

local_stack() {
  wl_env
  env -i "${CLEAN_ENV[@]}" node cloud/supabase/scripts/local-stack.mjs "$@"
}

wl_stop() {
  local had=0 n
  [ -d "$WL_DIR" ] && had=1
  for n in "${WL_PROCS[@]}"; do stop_proc "$n"; done
  if [ ! -f cloud/supabase/scripts/local-stack.mjs ]; then
    [ "$had" = 1 ] && rm -rf "$WL_DIR"
    echo "make stop: web-local is not running"
    return 0
  fi
  if ! command -v docker > /dev/null 2>&1 || ! docker info > /dev/null 2>&1; then
    if [ "$had" = 1 ]; then
      echo "make stop: web-local's processes are stopped, but Docker is not running; start it and run make stop again to remove $WL_NAME"
    else
      echo "make stop: web-local is not running"
    fi
    return 0
  fi
  if [ -n "$(stack_leftovers)" ]; then
    local_stack stop --name "$WL_NAME" --ports "$WL_BASE"
    had=1
  fi
  if [ "$had" = 1 ]; then
    rm -rf "$WL_DIR"
    echo "make stop: web-local is stopped ($WL_NAME's containers and volumes and its env, pid and log folder are removed)"
  else
    echo "make stop: web-local is not running"
  fi
}

with_env() {
  wl_env
  . "$WL_DIR/env"
}

users() {
  with_env
  env -i "${CLEAN_ENV[@]}" OAB_SB_API_URL="$OAB_SB_API_URL" OAB_SB_DB_URL="$OAB_SB_DB_URL" OAB_SB_SECRET_KEY="$OAB_SB_SECRET_KEY" \
    node scripts/make/web-local-users.mjs "$@"
}

need_running() {
  [ -f "$WL_DIR/env" ] || die "web-local is not running; start it with make run web-local"
}

start_bg() {
  local name="$1" port="$2" dir="$3" i
  shift 3
  (
    cd "$dir"
    nohup env -i "${CLEAN_ENV[@]}" "$@" < /dev/null >> "$WL_DIR/logs/$name.log" 2>&1 &
    echo $! > "$WL_DIR/$name.pid"
  )
  for i in $(seq 1 240); do
    port_busy "$port" && return 0
    kill -0 "$(cat "$WL_DIR/$name.pid")" 2> /dev/null || die "the $name exited at startup; see $WL_DIR/logs/$name.log (then make stop)"
    sleep 0.5
  done
  die "the $name never listened on $port; see $WL_DIR/logs/$name.log (then make stop)"
}

print_links() {
  local admin member
  admin="$(users link "$WL_ADMIN")"
  member="$(users link "$WL_MEMBER")"
  echo "  Sign in as the admin ($WL_ADMIN):"
  echo "    $admin"
  echo "  Sign in as the member ($WL_MEMBER):"
  echo "    $member"
  echo "  Each link works once, for an hour. New ones: bash scripts/make/web-local.sh links"
}

wl_start() {
  [ -f cloud/supabase/scripts/local-stack.mjs ] || die "cloud/ is not in this checkout; web-local runs the hosted agent and web from it"
  command -v docker > /dev/null 2>&1 || die "Docker is not installed. Install Docker Desktop (https://docs.docker.com/desktop/), start it, then run make web-local again."
  need_docker web-local
  command -v supabase > /dev/null 2>&1 \
    || die "the Supabase CLI is missing. Install it with brew install supabase/tap/supabase (or see https://supabase.com/docs/guides/local-development/cli/getting-started), then run make web-local again."
  local limits
  limits="$(node scripts/make/web-local-env.mjs --limits-only)" || exit 1
  [ -x node_modules/.bin/next ] && [ -x node_modules/.bin/tsx ] || die "the dependencies are not installed; run npm ci first"
  [ ! -e "$WL_DIR" ] || die "web-local is already running, or was not stopped cleanly ($WL_DIR exists); run make stop first"
  local p
  for p in "$WL_AGENT" "$WL_WEB" "$WL_STUB"; do
    ! port_busy "$p" || die "port $p is in use; web-local needs $WL_AGENT-$WL_STUB and $WL_BASE-$((WL_BASE + 4))"
  done

  mkdir -p "$WL_DIR/logs"
  chmod 700 "$WL_DIR" "$WL_DIR/logs"
  trap 'echo "make web-local: failed; logs are in $WL_DIR/logs. Run make stop to clean up." >&2' ERR

  say "starting the local Supabase stack $WL_NAME on 127.0.0.1:$WL_BASE-$((WL_BASE + 4)) with every migration (the first run pulls images; a few minutes)"
  local_stack start --name "$WL_NAME" --ports "$WL_BASE" --site-url "$WL_APP" > "$WL_DIR/logs/supabase.log" 2>&1 \
    || die "the local stack did not start: $(tail -n 1 "$WL_DIR/logs/supabase.log"). Full log: $WL_DIR/logs/supabase.log (then make stop)"
  grep -E '^\[local-stack\]' "$WL_DIR/logs/supabase.log" | sed 's/^/  /' || true
  (umask 077 && local_stack env --name "$WL_NAME" > "$WL_DIR/stack.env")
  wl_env
  env -i "${CLEAN_ENV[@]}" LIMIT_RUNNING_PER_USER="${LIMIT_RUNNING_PER_USER:-}" LIMIT_REQUESTS_PER_HOUR="${LIMIT_REQUESTS_PER_HOUR:-}" \
    LIMIT_REQUESTS_PER_MONTH="${LIMIT_REQUESTS_PER_MONTH:-}" LIMIT_RUNNING_SERVER="${LIMIT_RUNNING_SERVER:-}" \
    node scripts/make/web-local-env.mjs --stack "$WL_DIR/stack.env" --out "$WL_DIR/env" > /dev/null
  rm -f "$WL_DIR/stack.env"
  say "a fresh env for this run is in $WL_DIR/env (0600; local stack keys, new secrets, Cloudflare's always-pass Turnstile test keys)"

  users create "$WL_ADMIN" | sed 's/^/  /'
  users create "$WL_MEMBER" | sed 's/^/  /'
  users onboarded "$WL_MEMBER" | sed 's/^/  /'

  say "building the hosted agent (cloud/agent) and web app (cloud/web); logs in $WL_DIR/logs"
  with_env
  env -i "${CLEAN_ENV[@]}" npm run build -w @oab/cloud-agent > "$WL_DIR/logs/agent-build.log" 2>&1 \
    || die "the agent build failed; see $WL_DIR/logs/agent-build.log (then make stop)"
  (cd cloud/web && env -i "${CLEAN_ENV[@]}" NEXT_PUBLIC_SUPABASE_URL="$OAB_SB_API_URL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$OAB_SB_PUBLISHABLE_KEY" \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY" ../../node_modules/.bin/next build) > "$WL_DIR/logs/web-build.log" 2>&1 \
    || die "the web build failed; see $WL_DIR/logs/web-build.log (then make stop)"

  local model="stub"
  if [ "${WEB_LOCAL_STUB:-1}" = 0 ]; then
    model="none"
  else
    start_bg stub "$WL_STUB" "$PWD" STUB_PORT="$WL_STUB" ./node_modules/.bin/tsx e2e/support/stubModel.ts
  fi
  start_bg agent "$WL_AGENT" "$PWD" SUPABASE_LOCAL_STACK=1 SUPABASE_URL="$OAB_SB_API_URL" SUPABASE_PUBLISHABLE_KEY="$OAB_SB_PUBLISHABLE_KEY" \
    SUPABASE_SECRET_KEY="$OAB_SB_SECRET_KEY" AGENT_SERVICE_SECRET="$AGENT_SERVICE_SECRET" CREDENTIAL_KEYS="$CREDENTIAL_KEYS" \
    ACCESS_REQUEST_PEPPER="$ACCESS_REQUEST_PEPPER" RENDERER_SECRET="$RENDERER_SECRET" APP_ORIGIN="$WL_APP" AGENT_PORT="$WL_AGENT" \
    TURNSTILE_SECRET_KEY="$TURNSTILE_SECRET_KEY" LOG_LEVEL=info LIMIT_RUNNING_PER_USER="$LIMIT_RUNNING_PER_USER" \
    LIMIT_REQUESTS_PER_HOUR="$LIMIT_REQUESTS_PER_HOUR" LIMIT_REQUESTS_PER_MONTH="$LIMIT_REQUESTS_PER_MONTH" \
    LIMIT_RUNNING_SERVER="$LIMIT_RUNNING_SERVER" node cloud/agent/dist/server.js
  start_bg web "$WL_WEB" "$PWD/cloud/web" APP_ORIGIN="$WL_APP" AGENT_URL="http://127.0.0.1:$WL_AGENT" \
    AGENT_SERVICE_SECRET="$AGENT_SERVICE_SECRET" NEXT_PUBLIC_SUPABASE_URL="$OAB_SB_API_URL" \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$OAB_SB_PUBLISHABLE_KEY" NEXT_PUBLIC_TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY" \
    ../../node_modules/.bin/next start -p "$WL_WEB"
  local i
  for i in $(seq 1 60); do
    curl -fsS -o /dev/null "http://127.0.0.1:$WL_AGENT/health" && curl -fsS -o /dev/null "$WL_APP/login" && break
    [ "$i" -lt 60 ] || die "the agent or web app does not answer; see $WL_DIR/logs (then make stop)"
    sleep 1
  done
  trap - ERR

  echo
  say "Open Agent (M7 on a local Supabase) is up"
  echo "  Web app: $WL_APP"
  print_links
  echo "  Email-link sign-in: enter $WL_ADMIN or $WL_MEMBER on the login page, then open the email in Mailpit: http://127.0.0.1:$WL_MAIL"
  echo "  Limits: $limits (override per run, e.g. LIMIT_REQUESTS_PER_MONTH=5 make run web-local)"
  if [ "$model" = stub ]; then
    echo "  Model: the demos' stub model at http://127.0.0.1:$WL_STUB/v1. As the admin, in onboarding (or Settings → Models) choose Custom server,"
    echo "    URL http://127.0.0.1:$WL_STUB/v1, name Stub model, key $WL_STUB_KEY, then the model stub-1. Private-network servers are admin-only,"
    echo "    so the member needs a real provider key: Settings → Models → add your key (it is stored in this local stack only)."
  else
    echo "  Model: none (WEB_LOCAL_STUB=0). Add a real provider key in Settings → Models; it is stored in this local stack only."
  fi
  local mode
  mode="$(users mode)"
  echo "  Signup mode: $mode. Switch with bash scripts/make/web-local.sh mode invite|waitlist|open (the agent and web cache it 60 s;"
  echo "    configure-auth.mjs is for production only). In open mode each account passes a one-time human check (always-pass test keys)."
  echo "  No web search or report cards in this run (no SearXNG or renderer). Logs: $WL_DIR/logs"
  echo "  Stop it (and remove $WL_NAME's containers and data): make stop"
}

case "${1:-start}" in
  start) wl_start ;;
  stop) wl_stop ;;
  links)
    need_running
    print_links
    ;;
  mode)
    need_running
    if [ -n "${2:-}" ]; then
      mode="$(users mode "$2")"
      say "signup mode is now $mode (the agent and web pick it up within 60 s)"
    else
      mode="$(users mode)"
      say "signup mode is $mode"
    fi
    ;;
  *) die "usage: web-local.sh [start|stop|links|mode [invite|waitlist|open]]" ;;
esac
