#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "1. the root checks (AC 1, 24)"
run lint "npm run lint > \"$DEMO_DIR/root-lint.log\" 2>&1; rc=\$?; grep -cE 'warning|error' \"$DEMO_DIR/root-lint.log\" | sed 's/^/lint warning or error lines: /'; exit \$rc"
run format "npm run format:check > \"$DEMO_DIR/root-format.log\" 2>&1"
run typecheck "npm run typecheck > \"$DEMO_DIR/root-typecheck.log\" 2>&1"
run test "COPILOTKIT_TELEMETRY_DISABLED=true npm test > \"$DEMO_DIR/root-test.log\" 2>&1; rc=\$?; grep -E '^ +(Test Files|Tests) |^# (pass|fail)' \"$DEMO_DIR/root-test.log\"; exit \$rc"
run build "npm run build > \"$DEMO_DIR/root-build.log\" 2>&1"
run boundary "node scripts/boundary/cloud-boundary.mjs"
run ids "node scripts/ids-static.mjs"

step "1. no hosted UI in the desktop bundle (AC 3, D11)"
absent local-web-copy "packages/local-web/dist holds none of the hosted copy (grep found nothing)" "local_web_copy"

step "1. limits, attempts, stale slots and refusal bodies, verbose (AC 12, 15)"
run limits-unit "cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npx vitest run test/limits --reporter=verbose 2>&1 | grep -E '✓|×|Test Files|Tests '"

step "1. static safety and the Gate 8 helpers (AC 24, 27)"
run static-safety "node --test --test-reporter=spec cloud/supabase/test/staticSafety.test.mjs"
run gate8-helpers "node --test --test-reporter=spec cloud/supabase/test/checkPushPlan.test.mjs cloud/supabase/test/checkOldBodies.test.mjs"
