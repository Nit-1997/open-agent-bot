#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "0. safety lines"
safety_lines

step "0. guards (read-only): the live stack's names, Supabase access env, the .env guards, leftovers, Docker memory"
attempt live-before "no open-agent-bot containers listed (grep found none)" "live_snapshot before"
refuse_supabase_env
no_open_agent_project
run root-guard "docker compose config --format json --no-env-resolution | jq -r .name"
need guards-oab "an unqualified compose command here would reach a non-oab project" \
  "docker compose config --format json --no-env-resolution | jq -r .name | grep -q '^oab-'"
absent no-m7-leftovers "no oab-m7-demo or oab-m7-g8 container, volume or network is left from an earlier run (grep found none)" "m7_leftovers"
memory_check
run head "git log --oneline -1"

step "0. a fresh run folder and the oab-m7-demo stack (18700-18704)"
run secrets "demo_env_secrets"
run stack-start "stack_start oab-m7-demo"
run stack-env "demo_env_stack"

step "0. port bindings (S14, A5)"
run bindings "stack_bindings"
note "Kong, Postgres and Mailpit publish on 0.0.0.0 and [::]: CLI 2.111.0 has no bind-address option (A5). Accepted (S14):"
note "the stack uses the CLI's default local credentials, holds only @example.test users, is up only during this run, and macOS's firewall applies."
