#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

clean_env() {
  CLEAN_ENV=(PATH="$PATH" HOME="$HOME")
  local v
  for v in DOCKER_HOST DOCKER_CONFIG DOCKER_CONTEXT DOCKER_CERT_PATH DOCKER_TLS_VERIFY; do
    [ -n "${!v-}" ] && CLEAN_ENV+=("$v=${!v}")
  done
  return 0
}

need_docker() {
  docker info >/dev/null 2>&1 && return 0
  echo "make $1: Docker is not running (or not installed). Start Docker Desktop, wait until it says it is running, then run make $1 again." >&2
  return 1
}

PREVIEW_PROJECT=oab-preview
PREVIEW_FILES=(-f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --profile local)
