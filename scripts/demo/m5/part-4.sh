#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"
B="$DRY/$V2"

step "4. services-only dry run B ($V2) for the update (AC 18; reuses the builder's layer cache)"
run dry-run-b "npm run release:dry-run -- --version $V2 --registry 127.0.0.1:18501 --builder oab-factory-m5-builder --out $B --services-only 2>&1 | tee $DEMO_DIR/dry-run-b.out"
run manifest-b "jq . $B/lock/open-agent-services.json"
run mock-tree "find $B/mock-release -type f | sort && jq . $B/mock-release/latest.json"
