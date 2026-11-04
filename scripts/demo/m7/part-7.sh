#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

load_run_env

step "7. self-serve delete with the typed email, and the Terms/Privacy drafts (AC 22)"
run stub "stub_up"
run agent "agent_up 1 1000 1000 8"
run web "web_up"
run user-d "users create d && users onboarded d && users counts d"
run browser-delete "browser delete legal"
run gone "users counts d"

step "7. delete carry-over and re-sign-up, verbose (AC 22)"
run tombstone-local "cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run test:local -- test/local/tombstone.local.test.ts test/local/selfDelete.local.test.ts --reporter=verbose 2>&1 | grep -E '✓|×|↓|Test Files|Tests '"
