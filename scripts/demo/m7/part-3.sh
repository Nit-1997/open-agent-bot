#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

load_run_env

step "3. the web app built with the Turnstile test site key for APP_ORIGIN=$APP, the stub model, users A (admin) and N (member)"
run web-build "web_build && tail -n 3 \"$DEMO_DIR/web-build.log\""
run stub "stub_up"
run users "users create a admin && users create n && users onboarded n"
run agent "agent_up 1 2 1000 8"
run web "web_up"

step "3a. hourly cap: LIMIT_REQUESTS_PER_HOUR=2 (AC 6, 9, 13)"
run browser-hour "browser limits-hour"

step "3b. monthly cap: LIMIT_REQUESTS_PER_MONTH=3 (AC 5, 13)"
run agent "agent_up 1 1000 3 8"
run browser-month "browser limits-month"

step "3c. one running chat per user: LIMIT_RUNNING_PER_USER=1, A stops during the long run (AC 7)"
run agent "agent_up 1 1000 1000 8"
run browser-running "browser limits-running"

step "3d. one run on the server: LIMIT_RUNNING_SERVER=1, N waits for A (AC 8)"
run agent "agent_up 1 1000 1000 1"
run browser-server "browser limits-server"

step "3e. fail closed: request_admit revoked, then granted again (AC 10)"
run agent "agent_up 1 1000 1000 8"
run browser-unavailable "browser limits-unavailable"
run agent-log "grep -E '\\[limits\\]' \"$DEMO_DIR/agent.log\" | tail -n 5"
