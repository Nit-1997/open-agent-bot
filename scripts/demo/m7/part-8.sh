#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

load_run_env

step "8. stop every demo process, then both stacks (AC 25)"
run stop "stop_all"
no_background
run stack-demo "stack_stop oab-m7-demo"
run stack-g8 "stack_stop oab-m7-g8"
absent no-m7-leftovers "no oab-m7-demo or oab-m7-g8 container, volume or network is left (grep found none)" "m7_leftovers"

step "8. the live stack is untouched"
attempt live-after "no open-agent-bot containers listed (grep found none)" "live_snapshot after"
run live-diff "diff \"$DEMO_DIR/live-before.txt\" \"$DEMO_DIR/live-after.txt\" && echo 'live unchanged (names, states, CreatedAt)'"
no_open_agent_project

step "8. no secret from this run in the evidence, and no request to a live Supabase host (counts only)"
run pattern-count "echo \"patterns: \$(secret_patterns \"$RUN/secrets.env\" \"$RUN/stack.env\" | wc -l | tr -d ' ')\""
need patterns-found "no secret patterns were read from the run folder, so the scan would prove nothing" \
  "[ \"\$(secret_patterns \"$RUN/secrets.env\" \"$RUN/stack.env\" | wc -l)\" -gt 0 ]"
run evidence-count "echo \"text files scanned: \$(evidence | wc -l | tr -d ' '), request logs and HARs: \$(request_logs | wc -l | tr -d ' ')\""
exits secret-scan 1 "0 lines in the evidence hold a value from this run's secrets (grep -c prints 0 and exits 1 = no match)" \
  "scan_text | grep -F -c -f <(secret_patterns \"$RUN/secrets.env\" \"$RUN/stack.env\")"
exits supabase-hosts 1 "the agent and web logs and the HARs name no [.]supabase[.]co or api[.]supabase[.]com host (grep -c prints 0 and exits 1)" "supabase_hosts"
run run-folder "rm -rf \"$RUN\" && rm -f \"$DEMO_DIR/run.path\" && echo 'run folder with the generated secrets removed'"
run exit-codes "column -t -s \$'\\t' \"$EXITS\" | awk 'NR == 1 || \$4 != 0'"
