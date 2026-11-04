#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"
A="$DRY/$V1"
B="$DRY/$V2"
PIDS=()
cleanup() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done
  wait 2>/dev/null
  node apps/desktop/scripts/stage-stack.mjs >/dev/null && echo "   restaged the committed lock"
}
trap cleanup EXIT

step "7. app windows in Playwright (AC 16-18): unpackaged build with the dry-run lock, mock release from dry run B, stub model"
run stage-lock "node apps/desktop/scripts/stage-stack.mjs --lock $A/lock/services.lock.json && npm run build -w @oab/desktop"
npx tsx apps/desktop/test/support/mockReleasesCli.mts --port 18502 --dir "$B/mock-release" --log "$DEMO_DIR/mock.log" &
PIDS+=("$!")
STUB_PORT=18503 npx tsx e2e/support/stubModel.ts &
PIDS+=("$!")
run wait-servers "for i in \$(seq 1 60); do nc -z 127.0.0.1 18502 && nc -z 127.0.0.1 18503 && break; sleep 0.5; done; nc -z 127.0.0.1 18502 && nc -z 127.0.0.1 18503"
run playwright-app "(cd e2e && DEMO_M5=1 DEMO_OUT=../$DEMO_DIR DEMO_RANGE=18515-18519 DEMO_STUB_PORT=18503 DEMO_RELEASES_PORT=18502 DEMO_PROJECT=oab-factory-m5-demo DEMO_LOCK=../$A/lock/services.lock.json DEMO_UPDATE_VERSION=$V2 DEMO_SLOWMO=250 npx playwright test -c playwright.desktop.config.ts --project desktop-demo -g 'M5 app')"
run keep-videos "rm -rf \"$DEMO_DIR/playwright-app\" && cp -R e2e/test-results/desktop \"$DEMO_DIR/playwright-app\" && find \"$DEMO_DIR/playwright-app\" -name '*.webm'"
run mock-log "cat \"$DEMO_DIR/mock.log\""
