#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"
A="$DRY/$V1"

step "8. docs: render, view, and run every documented command in a scratch clone (AC 19-23, 29, 30)"
run render "node scripts/docs/render-docs.mjs --out $DEMO_DIR/docs"
run playwright-docs "(cd e2e && DEMO_M5=1 DEMO_OUT=../$DEMO_DIR DEMO_DOCS_DIR=../$DEMO_DIR/docs DEMO_SLOWMO=250 npx playwright test -c playwright.desktop.config.ts --project desktop-demo -g 'M5 docs')"
run keep-videos "rm -rf \"$DEMO_DIR/playwright-docs\" && cp -R e2e/test-results/desktop \"$DEMO_DIR/playwright-docs\" && find \"$DEMO_DIR/playwright-docs\" -name '*.webm'"
S="$(mktemp -d)"
remember scratch "$S"
note "scratch folder $S"
run doc-commands "node scripts/docs/run-doc-commands.mjs --scratch \"$S\" --release-dir $A --log $DEMO_DIR/doc-commands.log --tsv $DEMO_DIR/doc-commands.tsv"
run doc-table "column -t -s \$'\\t' $DEMO_DIR/doc-commands.tsv"
