#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"

# This removes only volumes owned by the fixed CluChess Compose project:
# cluchess_postgres-data, cluchess_redis-data, cluchess_jwt-keys, and
# cluchess_app-node-modules and cluchess_protocol-node-modules.
docker compose --project-name cluchess down --volumes --remove-orphans
