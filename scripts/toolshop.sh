#!/usr/bin/env bash
# Start, seed and health-check the self-hosted Toolshop (docker-compose.yml), or stop it.
set -euo pipefail
cd "$(dirname "$0")/.."

# Fresh data, and an empty application cache: Laravel caches product lists, and a cache
# surviving a reseed serves ids that no longer exist ("The selected product id is invalid").
seed() {
  echo "Seeding the database (migrate:fresh --seed) and clearing the cache…"
  docker compose --env-file .env.toolshop exec -T laravel-api php artisan migrate:fresh --seed --force
  docker compose --env-file .env.toolshop exec -T laravel-api php artisan cache:clear
}

case "${1:-up}" in
  up)
    # CI builds the images beforehand with a layer cache (docker/bake-action) and sets
    # TOOLSHOP_BUILD=0; locally compose builds whatever changed.
    if [[ "${TOOLSHOP_BUILD:-1}" == "0" ]]; then build=(); else build=(--build); fi
    docker compose --env-file .env.toolshop up -d "${build[@]}" --wait
    seed
    node scripts/wait-for-toolshop.mjs
    ;;
  reseed)
    seed
    node scripts/wait-for-toolshop.mjs
    ;;
  down)
    docker compose --env-file .env.toolshop down --volumes --remove-orphans
    ;;
  *)
    echo "usage: $0 up|reseed|down" >&2
    exit 2
    ;;
esac
