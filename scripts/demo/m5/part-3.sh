#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"
A="$DRY/$V1"

step "3. release dry run A ($V1), end to end (AC 4, 5, 8, 10-13, 28)"
run dry-run-a "npm run release:dry-run -- --version $V1 --registry 127.0.0.1:18501 --builder oab-factory-m5-builder --out $A 2>&1 | tee $DEMO_DIR/dry-run-a.out"
run listing "ls -l $A/lock $A/dmgs $A/release"
run shasum "(cd $A/release && shasum -a 256 -c SHA256SUMS)"

step "3. a tampered download fails the check (AC 12): one flipped byte in a copy of the arm64 DMG"
TD="$DEMO_DIR/tamper"
run tamper-copy "rm -rf \"$TD\" && mkdir \"$TD\" && cp -c $A/release/SHA256SUMS $A/release/open-agent-services.json $A/release/Open-Agent-$V1-arm64.dmg \"$TD\"/ && node -e 'const fs = require(\"fs\"); const b = fs.readFileSync(process.argv[1]); b[4096] ^= 0xff; fs.writeFileSync(process.argv[1], b)' \"$TD/Open-Agent-$V1-arm64.dmg\""
exits tamper-cmp 1 "cmp lists the one flipped byte (files differ, expected)" "cmp -l $A/release/Open-Agent-$V1-arm64.dmg \"$TD/Open-Agent-$V1-arm64.dmg\""
exits tamper-shasum 1 "the tampered arm64 DMG is FAILED, the manifest OK (expected refusal)" "(cd \"$TD\" && shasum -a 256 -c SHA256SUMS)"
run tamper-clean "rm -rf \"$TD\""

step "3. release notes: commit subjects render as inline code (A14c)"
run notes-changes "awk '/^## Changes/ { on = 1 } on && n++ < 10' $A/release/notes.md"
run manifest "jq . $A/release/open-agent-services.json"
run draft "jq . $A/release/draft-release.json"
run inspect-index "docker buildx imagetools inspect 127.0.0.1:18501/oab-m5-open-agent:$V1"

step "3. one version everywhere (AC 4)"
run lock-version "jq -r '\"lock \\(.kind) \\(.version) agent=\\(.images.agent)\"' $A/lock/services.lock.json"
run index-digest "docker buildx imagetools inspect 127.0.0.1:18501/oab-m5-open-agent:$V1 --format '{{json .Manifest}}' | jq -r '\"tag :$V1 → index \\(.digest)\"'"
run label-version "docker buildx imagetools inspect 127.0.0.1:18501/oab-m5-open-agent:$V1 --format '{{json .Image}}' | jq -r 'to_entries[] | \"\\(.key) label version \\(.value.config.Labels[\"org.opencontainers.image.version\"])\"'"
run dmg-names "ls $A/release | grep -E '^Open-Agent-.*\\.dmg$'"
run plist-version "for a in mac-arm64; do printf '%s CFBundleShortVersionString ' \$a; plutil -extract CFBundleShortVersionString raw \"apps/desktop/release/\$a/Open Agent.app/Contents/Info.plist\"; done"
run smoke-lock-line "grep -h 'services.lock.json kind=' $DEMO_DIR/dry-run-a.out | sort -u"
