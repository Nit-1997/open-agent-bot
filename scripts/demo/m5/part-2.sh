#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

step "2. local registry on 127.0.0.1:18501 and the docker-container builder"
run registry "docker run -d --name oab-factory-m5-registry -p 127.0.0.1:18501:5000 \"\$(docker image inspect registry:2 --format '{{index .RepoDigests 0}}')\""
run buildkitd-config "printf '[registry.\"127.0.0.1:18501\"]\n  http = true\n  insecure = true\n' > \"$DEMO_DIR/buildkitd.toml\" && cat \"$DEMO_DIR/buildkitd.toml\""
run builder "docker buildx create --name oab-factory-m5-builder --driver docker-container --driver-opt network=host --buildkitd-config \"$DEMO_DIR/buildkitd.toml\""
run builder-boot "docker buildx inspect --bootstrap oab-factory-m5-builder"
