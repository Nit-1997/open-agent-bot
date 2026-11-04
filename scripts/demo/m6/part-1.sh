#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "1. the test plan (AC 1-5, 7, 16-19): install, lint, format, typecheck, tests, build"
run npm-ci "npm ci > \"$DEMO_DIR/npm-ci.log\" 2>&1; rc=\$?; tail -n 2 \"$DEMO_DIR/npm-ci.log\"; exit \$rc"
for c in lint format:check typecheck test build; do
  run "npm-$c" "npm run $c > \"$DEMO_DIR/check-${c%%:*}.log\" 2>&1; rc=\$?; tail -n 4 \"$DEMO_DIR/check-${c%%:*}.log\"; exit \$rc"
done
run boundary "node scripts/boundary/cloud-boundary.mjs"
run script-tests "node --test scripts/test/*.test.mjs > \"$DEMO_DIR/script-tests.log\" 2>&1; rc=\$?; grep -E '^# (tests|pass|fail)' \"$DEMO_DIR/script-tests.log\"; exit \$rc"
run cloud-deploy "npm test -w @oab/cloud-deploy > \"$DEMO_DIR/cloud-deploy.log\" 2>&1; rc=\$?; grep -E '^ℹ (tests|pass|fail)' \"$DEMO_DIR/cloud-deploy.log\"; exit \$rc"
run workflows "npm run lint:workflows"

step "1. the guards, verbose"
run guard-tests "node --test --test-reporter spec scripts/test/cloudBoundary.test.mjs scripts/test/movedPaths.test.mjs scripts/test/verifyMove.test.mjs scripts/test/standalone.test.mjs scripts/test/demoParts.test.mjs 2>&1 | tee \"$DEMO_DIR/guard-tests.log\" | grep -E '^(▶|✔|✖|ℹ (tests|pass|fail))'"

step "1. pure moves (AC 2): verify-move on the three move PRs, re-run from git"
run verify-6.4 "node scripts/move/verify-move.mjs cc1c91f 2e5d75e c3e2d0a --moved cloud/agent/src --moved cloud/agent/test --moved cloud/agent/evals/auth --deleted packages/core/src/server.ts"
run verify-6.5 "node scripts/move/verify-move.mjs 206169a 6e1061a 3c8aaf2 --moved cloud/web --allow cloud/web/package.json --allow cloud/web/Dockerfile --allow cloud/web/eslint.config.mjs --allow cloud/web/README.md --allow cloud/web/test/lint/noCloudImports.test.ts --allow cloud/web/test/idsStatic.test.ts --allow cloud/web/test/desktopBoundary.test.ts"
run verify-6.6 "node scripts/move/verify-move.mjs 88f3f90 5218aa0 103ffd5 --moved cloud/supabase --moved cloud/deploy/compose.hosted.yml --moved cloud/deploy/compose.preview.yml --moved cloud/deploy/caddy --moved cloud/deploy/litellm --moved cloud/deploy/renderer --moved cloud/deploy/searxng --moved cloud/deploy/env.examples --moved cloud/e2e --moved cloud/README.md --allow cloud/README.md --allow cloud/deploy/compose.hosted.yml --allow cloud/e2e/package.json --allow cloud/e2e/tsconfig.json --allow cloud/e2e/biome.json --allow cloud/e2e/support/env.ts --allow cloud/e2e/support/env.test.ts --allow cloud/e2e/support/playwrightConfig.test.ts --allow cloud/supabase/scripts/gen-types.mjs"

step "1. layout (AC 1) and local, desktop and release inputs untouched (AC 7)"
absent old-paths "nothing tracked at the pre-M6 hosted paths (git ls-files lists none)" \
  "git ls-files packages/core/src/hosted web supabase deploy-config compose.hosted.yml packages/core/src/server.ts packages/core/src/scripts/rotateCredentials.ts docs/hosted.md | grep ."
run cloud-tree "ls -d cloud/agent cloud/web cloud/e2e cloud/supabase cloud/deploy cloud/README.md cloud/SECURITY.md && jq -c .workspaces package.json && for p in cloud/*/package.json; do jq -r .name \"\$p\"; done"
run local-unchanged "git diff --exit-code $M3_SHA -- docker-compose.yml local apps/desktop/services.lock.json .github/workflows/release.yml .github/workflows/evals-local.yml && echo 'local, desktop and release inputs unchanged'"

step "1. boundary injections (AC 5), each in a throwaway clone: every case fails with its own VIOLATION line"
INJ="$(scratch inject)"
run inject-clone "git clone -q \"file://$REPO\" \"$INJ/repo\" && git -C \"$INJ/repo\" log --oneline -1"
inject() {
  local label="$1" body="$2"
  run "inject-$label-apply" "(cd \"$INJ/repo\" && $body && git add -A)"
  exits "inject-$label" 1 "the boundary check refuses the injected $label case (expected)" \
    "node scripts/boundary/cloud-boundary.mjs --root \"$INJ/repo\" | grep -E 'VIOLATION|cloud-boundary:'"
  run "inject-$label-reset" "git -C \"$INJ/repo\" reset -q --hard && git -C \"$INJ/repo\" clean -fdq"
}
inject static "printf 'import { loadHostedConfig } from \"../../../cloud/agent/src/config.js\";\nexport const c = loadHostedConfig;\n' > packages/core/src/inject.ts"
run inject-static-biome-apply "printf 'import { loadHostedConfig } from \"../../../cloud/agent/src/config.js\";\nexport const c = loadHostedConfig;\n' > \"$INJ/repo/packages/core/src/inject.ts\""
exits inject-static-biome 1 "Biome names the file for the static case (expected)" \
  "(cd \"$INJ/repo/packages/core\" && \"$REPO/node_modules/.bin/biome\" lint src/inject.ts 2>&1 | sed -n '1,14p')"
run inject-static-biome-reset "git -C \"$INJ/repo\" clean -fdq"
inject dynamic "printf 'export const m = () => import(\"../../../cloud/agent/src/config.js\");\n' > packages/core/src/inject.ts"
inject type "printf 'import type { HostedConfig } from \"../../../cloud/agent/src/config.js\";\nexport type C = HostedConfig;\n' > packages/core/src/inject.ts"
inject css "printf '@import \"../../../../cloud/web/app/globals.css\";\n' > packages/ui/src/styles/inject.css"
inject tsconfig "printf '{ \"compilerOptions\": { \"paths\": { \"@x/*\": [\"../../cloud/web/*\"] } } }\n' > packages/ui/tsconfig.inject.json"
inject dockerfile "printf 'COPY cloud/agent /x\n' >> packages/core/Dockerfile"
inject dependency "node -e 'const f=\"packages/ui/package.json\";const p=JSON.parse(require(\"fs\").readFileSync(f));p.dependencies={...p.dependencies,\"@oab/cloud-web\":\"*\"};require(\"fs\").writeFileSync(f,JSON.stringify(p,null,2)+\"\\n\")'"
inject rule-c "printf 'export const p = \"../../cloud/web/app\";\n' > packages/ui/src/inject.ts"
inject symlink "ln -s ../cloud packages/inject-link"
run negatives-apply "(cd \"$INJ/repo\" && printf 'import \"@google-cloud/storage\";\nimport \"./cloudy\";\n// import \"../../../cloud/agent/src/config.js\";\n' > packages/core/src/negatives.ts && printf '{ \"files\": { \"includes\": [\"**/cloud/**\"] } }\n' > packages/core/biome.negatives.json && git add -A)"
run negatives "node scripts/boundary/cloud-boundary.mjs --root \"$INJ/repo\""

step "1. Tailwind still sees the shared UI (AC 21): selectors of the $M3_SHA web build equal the cloud/web build"
run css-old-clone "clone_at $M3_SHA \"$INJ/old\""
run css-old-build "(cd \"$INJ/old\" && npm ci > \"$REPO/$DEMO_DIR/css-old-npm-ci.log\" 2>&1 && set -a && . \"$REPO/cloud/deploy/.env-nextjs\" && set +a && npm run build -w web > \"$REPO/$DEMO_DIR/css-old-build.log\" 2>&1); rc=\$?; tail -n 3 \"$DEMO_DIR/css-old-build.log\"; exit \$rc"
run css-before "node scripts/css-selectors.mjs \"$INJ/old/web/.next\" > \"$DEMO_DIR/css-selectors-before.txt\" && wc -l < \"$DEMO_DIR/css-selectors-before.txt\""
run css-after "node scripts/css-selectors.mjs cloud/web/.next > \"$DEMO_DIR/css-selectors-after.txt\" && wc -l < \"$DEMO_DIR/css-selectors-after.txt\""
run css-diff "diff \"$DEMO_DIR/css-selectors-before.txt\" \"$DEMO_DIR/css-selectors-after.txt\" && echo 'selector lists identical'"
run inject-cleanup "rm -rf \"$INJ\" && rm -f \"$DEMO_DIR/scratch-inject.path\""
