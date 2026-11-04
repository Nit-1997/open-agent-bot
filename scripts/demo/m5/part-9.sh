#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "9. teardown"
expect down-clone "1=the clone project was already down" "down_clone"
expect down-demo "1=the demo project was already down" "down_demo"
expect down-pkg "1=the packaged-launch project was already down" "down_pkg"
expect registry-rm "1=the registry container was already gone" "docker rm -f -v oab-factory-m5-registry"
expect builder-rm "1=the builder was already gone" "docker buildx rm oab-factory-m5-builder"
expect images-rm "1=no oab-m5 image left to remove" "docker image rm \$(m5_images)"
expect tags-rm "1=no oab-m5 tag left to remove" "docker image rm \$(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '(^|/)oab-m5-|oab-factory-m5')"
for k in install scratch; do
  if [ -f "$DEMO_DIR/$k.path" ]; then
    D="$(recall "$k")"
    run "rm-$k" "rm -rf \"$D\" && rm -f \"$DEMO_DIR/$k.path\""
  fi
done

step "9. live and real state evidence (AC 25, 26)"
expect live-after "1=no open-agent-bot containers listed (grep found none)" \
  "docker ps --format '{{.Names}} {{.State}} {{.CreatedAt}}' | grep -E '^open-agent-bot' | sort > \"$DEMO_DIR/live-after.txt\""
note "status column (for reading; not diffed because 'Up N hours' moves on):"
docker ps --format '{{.Names}} {{.Status}}' | grep -E '^open-agent-bot' | sed 's/^/   /' || true
run live-diff "diff \"$DEMO_DIR/live-before.txt\" \"$DEMO_DIR/live-after.txt\" && echo 'live unchanged'"
expect realvols-after "1=no real open-agent-data/-keys volume exists (grep found none)" \
  "docker volume ls --format '{{.Name}}' | grep -E '^open-agent-(data|keys)$' > \"$DEMO_DIR/realvols-after.txt\""
run realvols-diff "diff \"$DEMO_DIR/realvols-before.txt\" \"$DEMO_DIR/realvols-after.txt\" && echo 'real volumes untouched'"
for d in "Application Support/Open Agent" "Logs/Open Agent"; do stat -f '%m %N' "$HOME/Library/$d" 2>/dev/null || echo "absent $d"; done > "$DEMO_DIR/realstate-after.txt"
run realstate-diff "diff \"$DEMO_DIR/realstate-before.txt\" \"$DEMO_DIR/realstate-after.txt\" && echo 'real app state untouched'"
absent no-m5-containers "no M5 containers left (grep found none)" "docker ps -a --format '{{.Names}}' | grep -E 'oab-(factory-)?m5'"
absent no-m5-builder "no M5 builder left (grep found none)" "docker buildx ls | grep oab-factory-m5"
absent no-m5-volumes "no M5 volumes left (grep found none)" "docker volume ls --format '{{.Name}}' | grep -E '^(oab-factory-m5|buildx_buildkit_oab-factory-m5)'"
absent no-m5-images "no M5 images left (grep found none)" "docker image ls -a --digests | grep -E 'oab-m5-|oab-factory-m5'"
run exit-codes "column -t -s \$'\\t' \"$EXITS\""
