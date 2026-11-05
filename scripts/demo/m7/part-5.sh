#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

load_run_env

step "5. the capability window: live role check and session fingerprint, verbose (AC 20, 21)"
run demotion-local "cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run test:local -- test/local/demotion.local.test.ts --reporter=verbose 2>&1 | grep -E '✓|×|↓|Test Files|Tests '"
run window-unit "cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npx vitest run test/identity/capabilityWindow.test.ts --reporter=verbose 2>&1 | grep -E '✓|×|Tests '"

step "5. in the browser: A's private-network model, A demoted by SQL, the same chat 32 s later"
run stub "stub_up"
run agent "agent_up 1 1000 1000 8"
run web "web_up"
run browser-capability "browser capability"
run demotion-log "grep -E '\\[auth\\] admin role ended|\\[session\\] capabilities changed' \"$DEMO_DIR/agent.log\" | tail -n 3"
