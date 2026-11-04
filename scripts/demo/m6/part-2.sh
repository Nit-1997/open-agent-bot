#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "2. standalone.sh refuses before deleting anything (AC 6)"
exits sa-worktree 2 "refused: this linked worktree is not a fresh clone (expected)" \
  "OAB_STANDALONE_ALLOW_DELETE=1 bash scripts/ci/standalone.sh"
SA="$(scratch standalone)"
run sa-clone "git clone -q \"file://$REPO\" \"$SA/oss\" && git -C \"$SA/oss\" log --oneline -1"
exits sa-noflag 2 "refused: OAB_STANDALONE_ALLOW_DELETE=1 is not set (expected)" "(cd \"$SA/oss\" && bash scripts/ci/standalone.sh)"
run sa-ignored-clone "git clone -q \"file://$REPO\" \"$SA/ignored\" && : > \"$SA/ignored/cloud/deploy/.env-dummy\" && git -C \"$SA/ignored\" status --porcelain --ignored -- cloud"
exits sa-ignored 2 "refused: an ignored file under cloud/ would be deleted; its name is listed (expected)" \
  "(cd \"$SA/ignored\" && OAB_STANDALONE_ALLOW_DELETE=1 bash scripts/ci/standalone.sh)"
run sa-ignored-cleanup "rm -rf \"$SA/ignored\""

step "2. the full standalone run in a scratch clone: cloud/ removed, every check, the local stack on 18610, the Mac app staged"
run standalone "(cd \"$SA/oss\" && OAB_STANDALONE_ALLOW_DELETE=1 OAB_STANDALONE_PROJECT=oab-factory-m6-oss OPEN_AGENT_PORT=18610 APP_ORIGIN=http://127.0.0.1:18610 OPEN_AGENT_DATA_VOLUME=oab-factory-m6-oss-data OPEN_AGENT_KEYS_VOLUME=oab-factory-m6-oss-keys OPEN_AGENT_IMAGE=oab-factory-m6-oss-agent:dev OPEN_AGENT_SEARCH_IMAGE=oab-factory-m6-oss-search:dev bash scripts/ci/standalone.sh --docker --hosted-free) > \"$DEMO_DIR/standalone.log\" 2>&1; rc=\$?; grep -E '^\\[standalone |^cloud-boundary:|preflight ok|\"Cmd\"|dist/local/main.js' \"$DEMO_DIR/standalone.log\"; exit \$rc"
run sa-lockfile "git -C \"$SA/oss\" diff --exit-code HEAD -- package-lock.json && echo 'package-lock.json unchanged'"
run sa-status "git -C \"$SA/oss\" status --porcelain | grep -Ev '^D  cloud/' | sed -n '1,5p'; git -C \"$SA/oss\" status --porcelain | grep -c '^D  cloud/'"
absent sa-leftovers "the standalone teardown left no oab-factory-m6-oss container, volume or image (grep found none)" \
  "{ docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker image ls --format '{{.Repository}}:{{.Tag}}'; } | grep -E '^oab-factory-m6-oss'"
run sa-cleanup "rm -rf \"$SA\" && rm -f \"$DEMO_DIR/scratch-standalone.path\""
