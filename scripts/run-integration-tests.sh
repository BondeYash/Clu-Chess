#!/bin/sh
set -eu

project_name="cluchess-phase2-test"

cleanup() {
  docker compose \
    --project-name "$project_name" \
    --file compose.yaml \
    --file compose.test.yaml \
    down --volumes --remove-orphans
}

trap cleanup EXIT INT TERM

docker compose \
  --project-name "$project_name" \
  --file compose.yaml \
  --file compose.test.yaml \
  run --build --rm test
