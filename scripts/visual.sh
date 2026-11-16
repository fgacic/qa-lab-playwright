#!/usr/bin/env bash
# Runs the visual specs inside the official Playwright image, the only place baselines are made
# or compared, so a Mac, a Linux laptop and CI all render the same pixels.
#   npm run test:visual            compare against the committed baselines
#   npm run test:visual:update     re-record only the baselines whose pixels changed beyond the tolerance (--update-snapshots=changed),
#                                  so a re-run does not rewrite every PNG and churn the repository (commit the result)
#
# Baseline storage: the 30 PNGs under tests/__screenshots__ weigh about 7.4 MB together and are committed as plain files.
# Every re-record of a page adds its new PNG to the history (home alone is 1.2 MB), and `changed` keeps that to the pages
# that really moved; a full re-record would add the whole 7.4 MB again. Plain git carries that easily for now.
# Recommendation: stay on plain files while the whole set is under roughly 25 MB; past that, move tests/__screenshots__
# to Git LFS (`git lfs track "tests/__screenshots__/**"`) and set `lfs: true` on the CI checkout. History is not migrated until then.
set -euo pipefail
cd "$(dirname "$0")/.."

# Baselines are rendered in a container only: say so plainly when Docker is missing or not running.
if ! command -v docker >/dev/null 2>&1; then
  echo "visual: Docker is not installed. Baselines are rendered only inside the official Playwright image, so install Docker (or Docker Desktop) first." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "visual: the Docker daemon is not running. Start Docker (Desktop) and run this again." >&2
  exit 1
fi

# Pinned by the digest of the linux/amd64 manifest (the tag stays for humans and for the CI check against
# @playwright/test; the digest is what is pulled). amd64 everywhere: an Apple Silicon Docker would otherwise pull the
# arm64 build, whose font hinting and anti-aliasing differ from CI's, and baselines recorded there would fail on CI.
# The multi-arch index digest is not used: it resolves to whichever local architecture is present. On a bump, change the
# tag and the digest together: docker buildx imagetools inspect <tag> lists the amd64 manifest digest.
IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble@sha256:ee15712262f017b8157421b212b12099146645f44b1bc5c0514cbbe6a229b1d0"
PLATFORM="linux/amd64"
if [[ "$(uname -s)" == "Linux" ]]; then
  # Run as the caller, so the report and any re-recorded baselines are not left owned by root.
  NETWORK=(--network host --user "$(id -u):$(id -g)"); HOST="localhost"
else
  # Docker Desktop: the host is reachable as host.docker.internal.
  NETWORK=(--add-host=host.docker.internal:host-gateway); HOST="host.docker.internal"
fi

# Mounted at the same path as on the host, so its blob report merges with the other jobs'.
# --init: a PID 1 that reaps the browsers' zombie processes, as the Playwright docs advise for this image.
docker run --rm --init --platform "$PLATFORM" --ipc=host "${NETWORK[@]}" \
  -v "$PWD":"$PWD" -w "$PWD" \
  -e CI -e REPORT_ID -e PLAYWRIGHT_DOCKER=1 -e TARGET=local -e HOME=/tmp \
  -e BASE_URL="http://${HOST}:4200" -e API_URL="http://${HOST}:4200/api" \
  "$IMAGE" npx playwright test --project=visual --workers=2 "$@"
