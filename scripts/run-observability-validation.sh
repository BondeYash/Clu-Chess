#!/bin/sh
set -eu

project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

docker run --rm \
  --entrypoint promtool \
  --volume "$project_directory/observability:/work:ro" \
  --workdir /work \
  prom/prometheus:v3.11.3 \
  check rules alerts.yml

docker run --rm \
  --entrypoint promtool \
  --volume "$project_directory/observability:/work:ro" \
  --workdir /work \
  prom/prometheus:v3.11.3 \
  test rules alerts.test.yml

docker compose \
  --file "$project_directory/compose.multi.yaml" \
  --file "$project_directory/compose.observability.yaml" \
  config --quiet

node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" \
  "$project_directory/observability/grafana/dashboards/cluchess-overview.json"
