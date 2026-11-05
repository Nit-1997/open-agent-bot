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
run parity "cd packages/core && COPILOTKIT_TELEMETRY_DISABLED=true npx vitest run test/copilot/parity.test.ts --reporter=verbose 2>&1 | grep -E '✓|×|Tests '"

step "1. local and desktop unaffected (AC 2): no change under the local paths since $M7_BASE"
run ac2-diff "git diff --stat --exit-code \"$M7_BASE\" HEAD -- docker-compose.yml local apps/desktop .github/workflows/release.yml && echo \"docker-compose.yml, local/, apps/desktop/ and release.yml match $M7_BASE\""

step "1. the desktop e2e suite (Electron test mode, fake docker CLI, state in \$TMPDIR) (AC 2)"
run desktop-prep "(npm run electron:install -w @oab/desktop && npm run build -w @oab/desktop && npm run stage -w @oab/desktop) > \"$DEMO_DIR/desktop-prep.log\" 2>&1"
run desktop-e2e "(cd e2e && npx playwright test -c playwright.desktop.config.ts --project desktop-fake) > \"$DEMO_DIR/desktop-e2e.log\" 2>&1; rc=\$?; grep -E '^ +[0-9]+ (passed|failed|skipped|flaky)' \"$DEMO_DIR/desktop-e2e.log\"; exit \$rc"

step "1. the local e2e suite on the local stack oab-m7-local (127.0.0.1:18740, stub model on 18722) (AC 2)"
run local-up "local_up"
run local-stub "stub_up"
run local-e2e "APP_ORIGIN=http://127.0.0.1:18740 STUB_PORT=18722 npm run local -w e2e > \"$DEMO_DIR/local-e2e.log\" 2>&1; rc=\$?; grep -E '^ +[0-9]+ (passed|failed|skipped|flaky)' \"$DEMO_DIR/local-e2e.log\"; exit \$rc"
run local-stub-stop "stop_bg stub"
run local-down "down_local > \"$DEMO_DIR/local-down.log\" 2>&1"
run local-images "docker image rm oab-m7-local-agent:dev oab-m7-local-search:dev > /dev/null && echo 'oab-m7-local images removed'"
run local-markers "rm -rf e2e/.local && echo 'e2e/.local markers removed (git-ignored)'"

step "1. the standalone job in a scratch clone: cloud/ removed, --docker --hosted-free on 18741 (AC 2)"
SA="$(scratch standalone)" || exit 1
run sa-clone "git clone -q \"file://$REPO\" \"$SA/oss\" && git -C \"$SA/oss\" checkout -q --detach \"$(git rev-parse HEAD)\" && git -C \"$SA/oss\" log --oneline -1"
run standalone "(cd \"$SA/oss\" && unset SUPABASE_URL && OAB_STANDALONE_ALLOW_DELETE=1 OAB_STANDALONE_PROJECT=oab-m7-oss OPEN_AGENT_PORT=18741 APP_ORIGIN=http://127.0.0.1:18741 OPEN_AGENT_DATA_VOLUME=oab-m7-oss-data OPEN_AGENT_KEYS_VOLUME=oab-m7-oss-keys OPEN_AGENT_IMAGE=oab-m7-oss-agent:dev OPEN_AGENT_SEARCH_IMAGE=oab-m7-oss-search:dev bash scripts/ci/standalone.sh --docker --hosted-free) > \"$DEMO_DIR/standalone.log\" 2>&1; rc=\$?; grep -E '^\\[standalone |^cloud-boundary:|preflight ok' \"$DEMO_DIR/standalone.log\"; exit \$rc"
run sa-cleanup "rm -rf \"$SA\" && rm -f \"$DEMO_DIR/scratch-standalone.path\" && echo 'scratch clone removed'"
absent ac2-leftovers "no oab-m7-local or oab-m7-oss container, volume or image is left (grep found none)" "ac2_leftovers"
