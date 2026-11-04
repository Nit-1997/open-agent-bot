#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

load_run_env

step "4. admin Usage tab: 7 seeded users through request_admit with p_now (AC 14)"
run stub "stub_up"
run agent "agent_up 1 1000 1000 8"
run web "web_up"
run seed "users seed 7"
run browser-admin "browser admin"

step "4. bad page, filter and id answer 400 before any database call; a member gets 404 (route tests, verbose)"
run admin-routes "cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npx vitest run test/limits/adminRoutes.test.ts --reporter=verbose 2>&1 | grep -E '✓|×|Tests '"
