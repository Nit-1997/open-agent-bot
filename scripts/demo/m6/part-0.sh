#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "0. guards (read-only): live stack, real volumes, the open-agent project, leftovers"
attempt live-before "no open-agent-bot containers listed (grep found none)" \
  "docker ps --format '{{.Names}} {{.State}} {{.CreatedAt}}' | grep -E '^open-agent-bot' | sort > \"$DEMO_DIR/live-before.txt\""
cat "$DEMO_DIR/live-before.txt"
attempt realvols-before "no real open-agent-data/-keys or open-agent-bot_* volume exists (grep found none)" \
  "docker volume ls --format '{{.Name}}' | grep -E '^(open-agent-(data|keys)|open-agent-bot_.*)$' | sort > \"$DEMO_DIR/realvols-before.txt\""
cat "$DEMO_DIR/realvols-before.txt"
no_open_agent_project
absent no-m6-leftovers "no M6 containers, volumes, networks or images left from an earlier run (grep found none)" \
  "{ docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker network ls --format '{{.Name}}'; docker image ls --format '{{.Repository}}'; } | grep -E '^oab-factory-m6-'"

step "0. the .env guards: unqualified compose commands here resolve to an oab- project (A38)"
run root-guard "docker compose config --format json --no-env-resolution | jq -r .name"
run hosted-guard "docker compose -f cloud/deploy/compose.hosted.yml config --format json --no-env-resolution | jq -r .name"
need guards-oab "an unqualified compose command here would reach a non-oab project" \
  "docker compose config --format json --no-env-resolution | jq -r .name | grep -q '^oab-' && docker compose -f cloud/deploy/compose.hosted.yml config --format json --no-env-resolution | jq -r .name | grep -q '^oab-'"
run head "git log --oneline -1"
