#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "5. the hosted app on the switched stack (AC 11): smoke on http://localhost:18300, Playwright video"
need stack-up "the switched oab-factory-m6-hosted stack from part 4 is not running" \
  "curl -fsS -o /dev/null http://127.0.0.1:18800/health && curl -fsS -o /dev/null http://localhost:18300/login"
run smoke "APP_ORIGIN=http://localhost:18300 npm run smoke -w @oab/cloud-e2e > \"$DEMO_DIR/smoke.log\" 2>&1; rc=\$?; grep -Ev '^\\s*$' \"$DEMO_DIR/smoke.log\" | tail -n 25; exit \$rc"
run smoke-video "mkdir -p \"$DEMO_DIR/smoke-video\" && find cloud/e2e/test-results -name '*.webm' -exec cp {} \"$DEMO_DIR/smoke-video/\" \; && ls -l \"$DEMO_DIR/smoke-video\""
run teardown-count "grep -E '^e2e teardown: removed [0-9]+ test users' \"$DEMO_DIR/smoke.log\""
run auth-probes "APP_ORIGIN=http://localhost:18300 AGENT_ORIGIN=http://127.0.0.1:18800 npx tsx cloud/e2e/scripts/auth-probes.mts > \"$DEMO_DIR/auth-probes.log\" 2>&1; rc=\$?; tail -n 30 \"$DEMO_DIR/auth-probes.log\"; exit \$rc"
run probe-teardown-count "grep -E '^e2e users cleaned up: [0-9]+ removed$' \"$DEMO_DIR/auth-probes.log\""

step "5. the hosted Playwright config refuses a non-preview origin before any browser starts (AC 14)"
exits smoke-live-refused 1 "refused: APP_ORIGIN is not a preview origin; no browser starts and no test user is created (expected)" \
  "APP_ORIGIN=https://app.localhost npm run smoke -w @oab/cloud-e2e > \"$DEMO_DIR/smoke-live-refused.log\" 2>&1; rc=\$?; grep -E 'refusing to run e2e' \"$DEMO_DIR/smoke-live-refused.log\" || { echo 'no refusal message in the log'; exit 9; }; exit \$rc"
