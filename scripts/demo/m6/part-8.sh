#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

SETTINGS="cloud/deploy/.env-agent cloud/deploy/.env-renderer cloud/deploy/.env-nextjs cloud/deploy/env-files/.env-supabase-admin cloud/deploy/env-files/.env-e2e"
evidence() { find "$DEMO_DIR" cloud/e2e/test-results -type f ! -name '*.webm' ! -name '*.mp4' ! -name '*.png' ! -name '*.zip' 2>/dev/null; }
traces() { find cloud/e2e/test-results -name trace.zip 2>/dev/null; }
scan_text() { evidence | while read -r f; do cat "$f"; done; traces | while read -r t; do unzip -p "$t"; done; }

step "8. teardown (AC 20): the hosted and standalone projects, through lib.sh's preflight-guarded helpers"
run down-hosted "down_hosted"
run down-gate7 "down_gate7"
run down-oss "down_oss"
run rm-images "rm_m6_images; m6_images || echo 'no oab-factory-m6 image left'"

step "8. no value from the factory settings files in the evidence (AC 22): patterns from a process substitution, counts only"
run pattern-count "echo \"patterns: \$(secret_patterns $SETTINGS | wc -l | tr -d ' ')\""
need patterns-found "no secret patterns were read from the settings files, so the scan would prove nothing" "[ \"\$(secret_patterns $SETTINGS | wc -l)\" -gt 0 ]"
run evidence-count "echo \"text files scanned: \$(evidence | wc -l | tr -d ' '), traces: \$(traces | wc -l | tr -d ' ')\""
exits secret-scan 1 "0 lines in the evidence hold a settings-file value (grep -c prints 0 and exits 1 = no match)" \
  "scan_text | grep -F -c -f <(secret_patterns $SETTINGS)"
if [ -e "$DEMO_DIR/scratch-secretfiles.path" ]; then
  SF="$(recall scratch-secretfiles)"
  exits dummy-scan 1 "the part 7 dummy secret appears nowhere in the evidence (grep -c prints 0 and exits 1 = no match)" \
    "scan_text | grep -F -c -f \"$SF/dummy-secret\""
fi
run scratch-cleanup "forget_scratch; ls \"$DEMO_DIR\"/*.path 2>/dev/null || echo 'no scratch dirs left'"

step "8. the live stack and the real volumes are untouched; no M6 leftovers"
attempt live-after "no open-agent-bot containers listed (grep found none)" \
  "docker ps --format '{{.Names}} {{.State}} {{.CreatedAt}}' | grep -E '^open-agent-bot' | sort > \"$DEMO_DIR/live-after.txt\""
run live-diff "diff \"$DEMO_DIR/live-before.txt\" \"$DEMO_DIR/live-after.txt\" && echo 'live unchanged (names, states, CreatedAt)'"
attempt realvols-after "no real open-agent-data/-keys or open-agent-bot_* volume exists (grep found none)" \
  "docker volume ls --format '{{.Name}}' | grep -E '^(open-agent-(data|keys)|open-agent-bot_.*)$' | sort > \"$DEMO_DIR/realvols-after.txt\""
run realvols-diff "diff \"$DEMO_DIR/realvols-before.txt\" \"$DEMO_DIR/realvols-after.txt\" && echo 'real volumes untouched'"
no_open_agent_project
absent no-m6-leftovers "no oab-factory-m6 container, volume, network or image is left (grep found none)" \
  "{ docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker network ls --format '{{.Name}}'; docker image ls --format '{{.Repository}}:{{.Tag}}'; } | grep -E '^oab-factory-m6-'"
run exit-codes "column -t -s \$'\\t' \"$EXITS\" | awk 'NR == 1 || \$4 != 0'"
