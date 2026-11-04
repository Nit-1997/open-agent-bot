#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "1. checks: the Test plan block (without the dry-run line)"
run npm-ci "npm ci"
run lint "npm run lint"
run format "npm run format:check"
run typecheck "npm run typecheck"
run test "npm test"
run build "npm run build"
run script-tests "node --test scripts/test/*.test.mjs"
run lint-workflows "npm run lint:workflows"
expect actionlint-left "1=no actionlint container left behind (grep -c printed 0)" \
  "docker ps -a --format '{{.Image}}' | grep -c actionlint"
run desktop-unit "npm test -w @oab/desktop -- services packagedSmoke packaging"
run desktop-fake "(cd e2e && npx playwright test -c playwright.desktop.config.ts --project desktop-fake)"

step "1. the release, workflow, docs and demo tests, verbose (AC 1-3, 6-9, 12, 13, 19-24, 27-31)"
run release-tests "node --test --test-reporter spec scripts/test/releaseWorkflow.test.mjs scripts/test/workflowPins.test.mjs scripts/test/basePins.test.mjs scripts/test/release.test.mjs scripts/test/docCommands.test.mjs scripts/test/demoParts.test.mjs"
