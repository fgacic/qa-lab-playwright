#!/usr/bin/env bash
# Runs the visual specs inside the official Playwright image, the only place baselines are made
# or compared, so a Mac, a Linux laptop and CI all render the same pixels.
#   npm run test:visual            compare against the committed baselines
#   npm run test:visual:update     re-record the baselines (commit the result)
# Needs the self-hosted Toolshop running (npm run toolshop:up).
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"
if [[ "$(uname -s)" == "Linux" ]]; then
  NETWORK=(--network host); HOST="localhost"
else
  # Docker Desktop: the host is reachable as host.docker.internal.
  NETWORK=(--add-host=host.docker.internal:host-gateway); HOST="host.docker.internal"
fi

docker run --rm --ipc=host "${NETWORK[@]}" \
  -v "$PWD":/work -w /work \
  -e CI -e REPORT_ID -e PLAYWRIGHT_DOCKER=1 -e TARGET=local \
  -e BASE_URL="http://${HOST}:4200" -e API_URL="http://${HOST}:4200/api" \
  "$IMAGE" npx playwright test --project=visual "$@"
