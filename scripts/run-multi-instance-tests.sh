#!/bin/sh

set -eu

cleanup() {
  docker compose \
    --project-name cluchess-multi-test \
    --file compose.multi.yaml \
    --profile test \
    down --volumes --remove-orphans
}

trap cleanup EXIT INT TERM
cleanup
docker compose \
  --project-name cluchess-multi-test \
  --file compose.multi.yaml \
  --profile test \
  up --build --abort-on-container-exit --exit-code-from smoke smoke
