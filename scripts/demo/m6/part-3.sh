#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "3. hosted compose equivalence with the pre-M6 baseline fixture (AC 8): key paths only, never values"
run cloud-deploy-tests "node --test --test-reporter spec --disable-warning=ExperimentalWarning cloud/deploy/test/*.test.mjs 2>&1 | tee \"$DEMO_DIR/cloud-deploy-tests.log\" | grep -E '^ *(✔|✖|ℹ (tests|pass|fail))'"

step "3. names-only view: project, volumes and published ports (all profiles, --no-env-resolution)"
run names-ports "docker compose --env-file /dev/null -f cloud/deploy/compose.hosted.yml --profile local --profile litellm --profile ollama config --format json --no-env-resolution | jq_names_ports"
need volume-names "the hosted project or a volume name changed" \
  "docker compose --env-file /dev/null -f cloud/deploy/compose.hosted.yml --profile local --profile litellm --profile ollama config --format json --no-env-resolution | jq_names | tr -d ' \n' | grep -qF '{\"name\":\"open-agent-bot\",\"volumes\":[\"open-agent-bot_caddy-config\",\"open-agent-bot_caddy-data\",\"open-agent-bot_ollama-data\",\"open-agent-bot_searxng-data\"]}'"
