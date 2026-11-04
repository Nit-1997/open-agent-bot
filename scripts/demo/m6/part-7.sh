#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

PATHS="deploy-config/.env-agent deploy-config/.env-renderer deploy-config/.env-nextjs deploy-config/.env-caddy deploy-config/.env-llm deploy-config/.env-search deploy-config/env-files/.env-supabase-admin deploy-config/env-files/.env-e2e"
PATHS="$PATHS ${PATHS//deploy-config/cloud/deploy} cloud/e2e/.auth/x.json cloud/e2e/test-results/trace.zip cloud/deploy/.env cloud/web/.env.local cloud/agent/.env"

dummy_sources() {
  local dir="$1" v
  v="$(cat "$SF/dummy-secret")"
  mkdir -p "$dir" && mkdir -m 700 "$dir/env-files" || return 1
  printf 'AGENT_SERVICE_SECRET=%s\n' "$v" > "$dir/.env-agent" && chmod 644 "$dir/.env-agent"
  printf 'RENDERER_SECRET=%s\n' "$v" > "$dir/.env-renderer" && chmod 600 "$dir/.env-renderer"
  printf 'E2E_OPENROUTER_KEY=%s\n' "$v" > "$dir/env-files/.env-e2e" && chmod 600 "$dir/env-files/.env-e2e"
  stat -f '%Lp %N' "$dir"/.env-* "$dir/env-files" "$dir"/env-files/.env-* | sed "s|$SF/||"
}
targets() { stat -f '%Lp %N' "$SF"/repo/cloud/deploy/.env-* "$SF/repo/cloud/deploy/env-files" "$SF"/repo/cloud/deploy/env-files/.env-* 2>/dev/null | sed "s|$SF/||"; }
reset_targets() { rm -f "$SF"/repo/cloud/deploy/.env-* && rm -rf "$SF/repo/cloud/deploy/env-files" && echo 'targets removed'; }
ctx_dummies() {
  local v
  v="$(cat "$SF/dummy-secret")"
  mkdir -p "$1/cloud/deploy/env-files" "$1/cloud/e2e/.auth" || return 1
  printf 'X_SECRET=%s\n' "$v" > "$1/cloud/deploy/.env-x"
  printf '%s\n' "$v" > "$1/cloud/deploy/env-files/notes.txt"
  printf '{"token":"%s"}\n' "$v" > "$1/cloud/e2e/.auth/s.json"
  printf '%s\n' "$v" > "$1/x.pem"
  printf '%s\n' "$v" > "$1/x.key"
  (cd "$1" && ls -a cloud/deploy/.env-x cloud/deploy/env-files/notes.txt cloud/e2e/.auth/s.json x.pem x.key)
}
ctx_dockerfile() {
  printf 'FROM %s\nCOPY . /ctx\nRUN find /ctx \\( -name ".env*" -o -path "*/.auth/*" -o -path "*/env-files/*" -o -name "*.pem" -o -name "*.key" \\) -print\n' "$BUSYBOX" > "$1"
  cat "$1"
}

step "7. git ignores every settings-file path, legacy and new (AC 15)"
run check-ignore "git check-ignore -v --non-matching $PATHS | tee \"$DEMO_DIR/check-ignore.txt\""
absent all-ignored "every listed path is ignored (no '::' non-matching line)" "grep '^::' \"$DEMO_DIR/check-ignore.txt\""
run ignore-tests "node --test --test-reporter spec cloud/deploy/test/envFiles.test.mjs scripts/test/gitignore.test.mjs scripts/test/dockerignore.test.mjs 2>&1 | grep -E '^ *(✔|✖|ℹ (tests|pass|fail))'"

step "7. env-files.mjs on dummy files only: dry run, copy, tighten, refusals, unknown file, move"
SF="$(scratch secretfiles)" || exit 1
run dummy-secret "openssl rand -hex 16 | sed 's/^/oab-dummy-/' > \"$SF/dummy-secret\" && echo \"dummy secret written to the scratch dir (\$(wc -c < \"$SF/dummy-secret\") bytes), never shown\""
run ef-clone "git clone -q \"file://$REPO\" \"$SF/repo\" && git -C \"$SF/repo\" log --oneline -1"
run ef-sources "dummy_sources \"$SF/old/deploy-config\""
EF="node \"$REPO/cloud/deploy/scripts/env-files.mjs\""
TO="--to \"$SF/repo/cloud/deploy\""
run ef-dry "$EF --from \"$SF/old/deploy-config\" $TO --copy --dry-run"
run ef-copy "$EF --from \"$SF/old/deploy-config\" $TO --copy && targets"
exits ef-again 1 "refused: every target exists already, reported exists-skip and never overwritten (expected)" "$EF --from \"$SF/old/deploy-config\" $TO --copy"
run ef-reset-1 "reset_targets"
run ef-link-source "mkdir -p \"$SF/link/deploy-config\" && ln -s \"$SF/old/deploy-config/.env-agent\" \"$SF/link/deploy-config/.env-agent\" && ls -la \"$SF/link/deploy-config\" | tail -n 1 | sed \"s|$SF/||g\""
exits ef-symlink 1 "refused: a symlinked source, before any write (expected)" "$EF --from \"$SF/link/deploy-config\" $TO --copy; rc=\$?; targets; exit \$rc"
run ef-unignore "printf '!cloud/deploy/.env-agent\n' >> \"$SF/repo/.gitignore\" && tail -n 1 \"$SF/repo/.gitignore\""
exits ef-not-ignored 1 "refused: git would not ignore a target, so it could be committed (expected)" "$EF --from \"$SF/old/deploy-config\" $TO --copy; rc=\$?; targets; exit \$rc"
run ef-reignore "git -C \"$SF/repo\" checkout -q .gitignore"
run ef-unknown-source "cp -R \"$SF/old\" \"$SF/unknown\" && : > \"$SF/unknown/deploy-config/.env-x\""
exits ef-unknown 2 "the unknown .env-x is listed 'unknown (not moved)'; the known files are copied (exit 2, expected)" "$EF --from \"$SF/unknown/deploy-config\" $TO --copy"
run ef-reset-2 "reset_targets"
run ef-move "$EF --from \"$SF/old/deploy-config\" $TO --move && targets && ls -A \"$SF/old/deploy-config\" \"$SF/old/deploy-config/env-files\""

step "7. the build context of a clone that holds only dummy secrets (AC 23): --no-cache, busybox pinned by digest"
run ctx-clone "git clone -q \"file://$REPO\" \"$SF/ctx\" && git -C \"$SF/ctx\" log --oneline -1"
run ctx-dummies "ctx_dummies \"$SF/ctx\""
run ctx-dockerfile "ctx_dockerfile \"$SF/ctx.Dockerfile\""
run ctx-build "docker build --no-cache --progress plain -t oab-factory-m6-ctx:dev -f \"$SF/ctx.Dockerfile\" \"$SF/ctx\" > \"$DEMO_DIR/ctx-build.log\" 2>&1; rc=\$?; grep -E '^#[0-9]+ [0-9.]+ /ctx/' \"$DEMO_DIR/ctx-build.log\" || echo 'find listed nothing'; exit \$rc"
absent ctx-secrets "none of the dummy secrets reached the build context (grep found none)" \
  "grep -E '/ctx/.*([.]env[-]x|notes[.]txt|/s[.]json|x[.]pem|x[.]key)' \"$DEMO_DIR/ctx-build.log\""
run ctx-cleanup "docker image rm oab-factory-m6-ctx:dev && rm -rf \"$SF/ctx\" \"$SF/ctx.Dockerfile\""

step "7. Supabase untouched (AC 13): migrations pinned by cloud/deploy/test/fixtures/migrations-pre-m6.sha256, no migration or auth-config command anywhere in the demo"
run migrations "node --test --test-reporter spec cloud/deploy/test/migrations.test.mjs 2>&1 | grep -E '^ *(✔|✖|ℹ (tests|pass|fail))'"
run gen-types-target "grep -n 'database.types.ts' cloud/supabase/scripts/gen-types.mjs"
absent no-supabase-change "no migration, auth-config apply or Supabase CLI command in the demo logs (grep found none)" \
  "find \"$DEMO_DIR\" -type f \\( -name '*.log' -o -name '*.rec' \\) -exec grep -HE 'configure-auth[.]mjs --apply|apply[_]migration|supabase (db|migration|link|functions) ' {} +"
