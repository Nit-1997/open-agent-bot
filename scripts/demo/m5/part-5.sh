#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"
A="$DRY/$V1"

step "5. install the dry-run DMG copy into a temp Applications folder (AC 14)"
T="$(mktemp -d)"
remember install "$T"
note "install folder $T"
run mount "mkdir \"$T/mnt\" && hdiutil attach -nobrowse -readonly -mountpoint \"$T/mnt\" $A/release/Open-Agent-$V1-arm64.dmg"
run copy "mkdir \"$T/Applications\" && ditto \"$T/mnt/Open Agent.app\" \"$T/Applications/Open Agent.app\" && hdiutil detach \"$T/mnt\""
run quarantine "xattr -w com.apple.quarantine \"0083;\$(printf %x \"\$(date +%s)\");Safari;\" \"$T/Applications/Open Agent.app\" && xattr -l \"$T/Applications/Open Agent.app\""
expect spctl "3=rejected: the app is unsigned (expected; users click Open Anyway)" \
  "spctl --assess --type execute -vv \"$T/Applications/Open Agent.app\""
note "the INSTALL.md line, path substituted:"
run xattr-remove "xattr -dr com.apple.quarantine \"$T/Applications/Open Agent.app\""
run xattr-after "xattr -l \"$T/Applications/Open Agent.app\"; echo \"(xattr -l printed \$(xattr -l \"$T/Applications/Open Agent.app\" | wc -l | tr -d ' ') lines)\""
