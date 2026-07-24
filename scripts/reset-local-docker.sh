#!/bin/sh
set -eu

# This removes only volumes owned by the fixed CluChess Compose project:
# cluchess_postgres-data, cluchess_redis-data, cluchess_jwt-keys, and
# cluchess_app-node-modules.
docker compose --project-name cluchess down --volumes --remove-orphans
