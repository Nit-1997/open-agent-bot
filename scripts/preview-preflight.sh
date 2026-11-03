#!/usr/bin/env bash
# Source this file, then run `preflight <compose command and flags>` before every mutating compose step.

preview_port_ok() {
  [ -z "$2" ] && return 0
  printf '%s' "$2" | grep -Eq '^[0-9]{4,5}$' && return 0
  echo "ABORT: $1 must be a 4 or 5 digit port, got '$2'" >&2
  return 1
}

preflight() {
  preview_port_ok PREVIEW_AGENT_PORT "${PREVIEW_AGENT_PORT-}" || exit 1
  preview_port_ok PREVIEW_WEB_PORT "${PREVIEW_WEB_PORT-}" || exit 1
  n="$("$@" config --format json | jq -r .name)"
  case "$n" in
    oab-*) echo "preflight ok: project '$n'" ;;
    *) echo "ABORT: project '$n'" >&2; exit 1 ;;
  esac
}
