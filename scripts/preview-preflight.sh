#!/usr/bin/env bash
# Source this file, then run `preflight <compose command and flags> || exit 1` before every mutating compose step.
# preflight returns 1 (never exits) so sourcing it in an interactive shell cannot close the terminal.

preview_port_ok() {
  [ -z "$2" ] && return 0
  printf '%s' "$2" | grep -Eq '^1[89][0-9]{3}$' && return 0
  echo "ABORT: $1 must be a port in 18000-19999, got '$2'" >&2
  return 1
}

preflight() {
  preview_port_ok PREVIEW_AGENT_PORT "${PREVIEW_AGENT_PORT-}" || return 1
  preview_port_ok PREVIEW_WEB_PORT "${PREVIEW_WEB_PORT-}" || return 1
  local cfg n
  cfg="$("$@" config --format json)" || { echo "ABORT: compose config failed" >&2; return 1; }
  n="$(printf '%s' "$cfg" | jq -r .name)"
  case "$n" in
    oab-*) ;;
    *) echo "ABORT: project '$n'" >&2; return 1 ;;
  esac
  printf '%s' "$cfg" | jq -e '[.services[].ports[]? | .host_ip] | all(. == "127.0.0.1")' >/dev/null \
    || { echo "ABORT: project '$n' publishes a port outside 127.0.0.1" >&2; return 1; }
  printf '%s' "$cfg" | jq -e '[.services[].ports[]? | .published | tonumber] | all(. >= 18000)' >/dev/null 2>&1 \
    || { echo "ABORT: project '$n' publishes a port below 18000" >&2; return 1; }
  echo "preflight ok: project '$n'"
}
