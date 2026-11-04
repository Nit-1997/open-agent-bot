#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

load_run_env
memory_check
PLAN="node cloud/supabase/scripts/check-push-plan.mjs"

step "2. the local integration suite on oab-m7-demo, verbose (AC 4, 9, 16, 17, 22, 23)"
run test-local "cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run test:local -- --reporter=verbose > \"$REPO/$DEMO_DIR/test-local.log\" 2>&1; rc=\$?; grep -E '✓|×|↓|Test Files|Tests ' \"$REPO/$DEMO_DIR/test-local.log\"; exit \$rc"
note "the suite removes its users in finally, so the usage tables are empty again"
run usage-tables "psql_demo -c \"select month, count(*) as users, sum(count) as requests from public.request_usage group by month order by month\" -c \"select count(*) as log_rows from public.request_log\""

step "2. the startup check (AC 11): a missing usage function stops the agent with the Gate 8 message"
run rename "psql_demo -c \"alter function public.request_usage_summary(timestamptz) rename to request_usage_summary_x\" -c \"notify pgrst, 'reload schema'\" && sleep 2"
exits agent-refuses 1 "the agent refused to start: a usage function is missing (Gate 8 message above)" "agent_check local 1 1000 1000 8"
run rename-back "psql_demo -c \"alter function public.request_usage_summary_x(timestamptz) rename to request_usage_summary\" -c \"notify pgrst, 'reload schema'\" && sleep 2"
run agent-starts "agent_check local 1 1000 1000 8"

step "2. the Gate 8 rehearsal on oab-m7-g8 (18710-18714), started at the last pre-M7 migration (AC 27)"
if [ "$M7_MODE" = sequential ]; then
  run demo-stop "stack_stop oab-m7-demo"
fi
run g8-start "stack_start oab-m7-g8"
run g8-old-bodies "g8_bodies"
run g8-pre-m7 "psql_g8 -XAtc \"\$($PLAN --pre-m7-query)\" | tee /dev/stderr | grep -qx 'pre-M7 objects present'"
run g8-plan "node cloud/supabase/scripts/local-stack.mjs push-dry-run --name oab-m7-g8 | tee \"$DEMO_DIR/g8-plan.txt\" | $PLAN"
exits plan-extra 1 "check-push-plan refuses a plan with one extra file (STOP, as Gate 8 step 3 says)" \
  "grep '^{' \"$DEMO_DIR/g8-plan.txt\" | sed 's/\"migrations\":\\[/\"migrations\":[\"extra.sql\",/' | $PLAN"

step "2. history repair: an empty live history (migrations applied by SQL paste) lists every file"
run g8-forget-history "psql_g8 -c \"delete from supabase_migrations.schema_migrations\""
exits plan-history 3 "the dry run lists the 12 pre-M7 migrations too: history repair needed (Gate 8 step 4)" \
  "node cloud/supabase/scripts/local-stack.mjs push-dry-run --name oab-m7-g8 | $PLAN"
run g8-repair "repair_g8 \$($PLAN --pre-m7-versions)"
run g8-plan-again "node cloud/supabase/scripts/local-stack.mjs push-dry-run --name oab-m7-g8 | $PLAN"

step "2. push, nothing left to push, the configure-auth preconditions"
run g8-push "node cloud/supabase/scripts/local-stack.mjs push --name oab-m7-g8"
run g8-applied "node cloud/supabase/scripts/local-stack.mjs push-dry-run --name oab-m7-g8 | $PLAN --applied"
run g8-preconditions "psql_g8 -XAtc \"select to_regprocedure('public.request_admit(uuid,integer,integer,timestamp with time zone)') is not null as m7_functions, (select count(*) from public.signup_settings) as settings_rows, (select mode from public.signup_settings) as mode, obj_description('private.before_user_created(jsonb)'::regprocedure) as hook_marker\""
exits old-bodies-after-push 1 "the pushed M7 bodies differ from rollback/m7.sql, as expected after Gate 8" "g8_bodies"

step "2. rollback/m7.sql restores the old bodies and clears the hook marker"
run g8-rollback "psql_g8 -q -f cloud/supabase/rollback/m7.sql"
run g8-bodies-restored "g8_bodies"
run g8-marker "psql_g8 -XAtc \"select coalesce(obj_description('private.before_user_created(jsonb)'::regprocedure), 'hook marker cleared')\""
run g8-stop "stack_stop oab-m7-g8"
if [ "$M7_MODE" = sequential ]; then
  run demo-restart "stack_start oab-m7-demo && demo_env_stack"
fi
