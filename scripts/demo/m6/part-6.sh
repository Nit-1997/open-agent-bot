#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "6. the Vercel-equivalent build (AC 12): a clean clone, install from Root Directory cloud/web, build there"
VB="$(scratch vercel)"
run vercel-clone "git clone -q \"file://$REPO\" \"$VB/repo\" && git -C \"$VB/repo\" log --oneline -1"
run no-web "test ! -e \"$VB/repo/web\" && echo 'no web/ folder'"
run install "(cd \"$VB/repo/cloud/web\" && npm install > \"$REPO/$DEMO_DIR/vercel-install.log\" 2>&1); rc=\$?; tail -n 3 \"$DEMO_DIR/vercel-install.log\"; exit \$rc"
run lockfile "git -C \"$VB/repo\" diff --exit-code package-lock.json && echo 'package-lock.json unchanged'"
run build "(cd \"$VB/repo/cloud/web\" && set -a && . \"$REPO/cloud/deploy/.env-nextjs\" && set +a && npm run build > \"$REPO/$DEMO_DIR/vercel-build.log\" 2>&1); rc=\$?; grep -E 'Compiled|Generating|Route' \"$DEMO_DIR/vercel-build.log\"; exit \$rc"
run server "ls -l \"$VB/repo/cloud/web/.next/standalone/cloud/web/server.js\""
run vercel-cleanup "rm -rf \"$VB\" && rm -f \"$DEMO_DIR/scratch-vercel.path\""
