#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

rehearse() {
  local sha="$1" file="$2" after="$3" base old m6
  base="$(scratch "rehearsal-$sha")"
  old="$base/old"
  m6="$base/m6"
  step "4.$sha the old layout ($file at $sha) under oab-factory-m6-hosted, beside the live stack"
  run "m6-clone-$sha" "git clone -q \"file://$REPO\" \"$m6\" && git -C \"$m6\" log --oneline -1"
  run "old-clone-$sha" "clone_at $sha \"$old\""
  run "old-env-$sha" "place_old_env \"$old\""
  need "old-preflight-$sha" "preflight refused the old layout with the preview override" "preflight old_compose \"$old\" $file \"$m6\""
  if ! attempt "old-up-$sha" "the $sha layout did not come up healthy with the factory settings files (see the config check below; recorded as an amendment)" \
    "old_compose \"$old\" $file \"$m6\" up -d --build --wait --wait-timeout 300 search renderer agent web > \"$DEMO_DIR/old-up-$sha.log\" 2>&1; rc=\$?; tail -n 6 \"$DEMO_DIR/old-up-$sha.log\"; exit \$rc"; then
    [ "$after" = teardown ] || exit 1
    run "env-files-$sha" "node \"$m6/cloud/deploy/scripts/env-files.mjs\" --from \"$old/deploy-config\" --to \"$m6/cloud/deploy\" --copy"
    attempt "config-check-$sha" "the M6 config check refused these settings files (the message names the variable)" "gate7_config_check \"$m6\""
    run "teardown-$sha" "down_gate7 && down_hosted && rm_m6_images && rm -rf \"$base\" && rm -f \"$DEMO_DIR/scratch-rehearsal-$sha.path\""
    return 0
  fi
  run "old-facts-$sha" "hosted_facts before-$sha"

  step "4.$sha owner steps 2-5: settings files, config check (names only), rollback tags"
  run "env-files-dry-$sha" "node \"$m6/cloud/deploy/scripts/env-files.mjs\" --from \"$old/deploy-config\" --to \"$m6/cloud/deploy\" --copy --dry-run"
  run "env-files-$sha" "node \"$m6/cloud/deploy/scripts/env-files.mjs\" --from \"$old/deploy-config\" --to \"$m6/cloud/deploy\" --copy"
  run "config-check-$sha" "gate7_config_check \"$m6\""
  run "gate7-down-$sha" "down_gate7 && docker image rm oab-factory-m6-gate7-agent"
  run "names-$sha" "docker compose -f \"$m6/cloud/deploy/compose.hosted.yml\" --env-file \"$m6/cloud/deploy/.env-nextjs\" --profile local config --format json | jq_names"
  run "retag-$sha" "retag_rollback $sha"

  step "4.$sha owner step 6: switch to cloud/deploy (up -d --build from the M6 clone)"
  need "new-preflight-$sha" "preflight refused the M6 layout" "preflight new_compose \"$m6\""
  run "switch-$sha" "new_compose \"$m6\" up -d --build --wait --wait-timeout 300 search renderer agent web > \"$DEMO_DIR/switch-$sha.log\" 2>&1; rc=\$?; tail -n 6 \"$DEMO_DIR/switch-$sha.log\"; exit \$rc"
  run "new-facts-$sha" "hosted_facts after-$sha"
  run "compare-switch-$sha" "compare_facts before-$sha after-$sha /cloud/deploy/ new"
  run "health-$sha" "curl -fsS http://127.0.0.1:18800/health && echo && curl -fsS -o /dev/null -w 'web /login %{http_code}\n' http://localhost:18300/login"

  step "4.$sha owner step 8: roll back (retag, the old command from the old tree without --build)"
  run "retag-back-$sha" "retag_back $sha"
  need "rollback-preflight-$sha" "preflight refused the old layout" "preflight old_compose \"$old\" $file \"$m6\""
  run "rollback-$sha" "old_compose \"$old\" $file \"$m6\" up -d --wait --wait-timeout 300 search renderer agent web > \"$DEMO_DIR/rollback-up-$sha.log\" 2>&1; rc=\$?; tail -n 6 \"$DEMO_DIR/rollback-up-$sha.log\"; exit \$rc"
  run "rollback-facts-$sha" "hosted_facts rollback-$sha"
  run "compare-rollback-$sha" "compare_facts after-$sha rollback-$sha /deploy-config/ new && diff \"$DEMO_DIR/before-$sha-images.txt\" \"$DEMO_DIR/rollback-$sha-images.txt\" && echo 'the old images run again on the same volumes'"

  if [ "$after" = teardown ]; then
    step "4.$sha full teardown of the project, its volumes, images and rollback tags"
    run "teardown-$sha" "down_hosted && rm_m6_images && rm -rf \"$base\" && rm -f \"$DEMO_DIR/scratch-rehearsal-$sha.path\""
    absent "teardown-check-$sha" "nothing of oab-factory-m6-hosted is left (grep found none)" \
      "{ docker ps -a --format '{{.Names}}'; docker volume ls --format '{{.Name}}'; docker image ls --format '{{.Repository}}'; } | grep -E '^oab-factory-m6-(hosted|gate7)'"
    return 0
  fi

  step "4.$sha switch forward again; this stack stays up for part 5"
  need "forward-preflight-$sha" "preflight refused the M6 layout" "preflight new_compose \"$m6\""
  run "forward-$sha" "new_compose \"$m6\" up -d --build --wait --wait-timeout 300 search renderer agent web > \"$DEMO_DIR/forward-$sha.log\" 2>&1; rc=\$?; tail -n 6 \"$DEMO_DIR/forward-$sha.log\"; exit \$rc"
  run "forward-facts-$sha" "hosted_facts forward-$sha && compare_facts rollback-$sha forward-$sha /cloud/deploy/ new"
  remember m6-clone "$m6"
}

rehearse c1c0f4e docker-compose.yml teardown
rehearse 4879d41 compose.hosted.yml keep

step "4. the hosted images (AC 9): Cmd and WorkingDir, and the rotation script in the agent image"
for svc in agent renderer web; do
  run "image-$svc" "image_inspect_oab '{{json .Config.Cmd}} {{.Config.WorkingDir}}' oab-factory-m6-hosted-$svc"
done
run rotate-script "docker run --rm --entrypoint sh oab-factory-m6-hosted-agent -c 'test -f dist/scripts/rotateCredentials.js && echo dist/scripts/rotateCredentials.js present'"
