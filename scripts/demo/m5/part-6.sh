#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"
A="$DRY/$V1"
T="$(recall install)"

step "6. first launch of the installed copy pulls the pinned images by digest via the bundled lock (AC 15)"
absent images-before "no oab-m5 images present before launch (grep found none)" "m5_images"
run packaged-launch "node apps/desktop/scripts/packagedSmoke.mjs --app \"$T/Applications/Open Agent.app\" --release $V1 --docker $DOCKER_CLI --expect-lock $A/lock/services.lock.json --project oab-factory-m5-pkg --range 18510-18514 --evidence $DEMO_DIR/pkg"
run pulls "grep -hE '\\[docker\\] pull|tokenFp|\\[app\\] app view loaded' $DEMO_DIR/pkg/shell-*.log"
run lock-refs "jq -r '.images[]' $A/lock/services.lock.json"
run images-after "m5_images"
run down "down_pkg"
expect remove-images "1=an image was already gone" "docker image rm \$(m5_images)"
absent images-gone "no oab-m5 images left for the fresh app launch (grep found none)" "m5_images"
