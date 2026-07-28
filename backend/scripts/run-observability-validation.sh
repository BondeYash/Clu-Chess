#!/bin/sh
set -eu

repository_directory=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
backend_directory="$repository_directory/backend"

docker run --rm \
  --entrypoint promtool \
  --volume "$backend_directory/observability:/work:ro" \
  --workdir /work \
  prom/prometheus:v3.11.3 \
  check rules alerts.yml

docker run --rm \
  --entrypoint promtool \
  --volume "$backend_directory/observability:/work:ro" \
  --workdir /work \
  prom/prometheus:v3.11.3 \
  test rules alerts.test.yml

docker compose \
  --file "$repository_directory/compose.multi.yaml" \
  --file "$repository_directory/compose.observability.yaml" \
  config --quiet

node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" \
  "$backend_directory/observability/grafana/dashboards/cluchess-overview.json"
