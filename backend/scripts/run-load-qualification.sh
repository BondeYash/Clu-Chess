#!/bin/sh

set -u

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"

profile="${1:-smoke}"
case "$profile" in
  smoke|target|stress|burst|soak) ;;
  *)
    echo "Usage: $0 [smoke|target|stress|burst|soak]" >&2
    exit 2
    ;;
esac

project="cluchess-phase12-load-${profile}"
artifact_root="${QUALIFICATION_ARTIFACT_DIR:-.artifacts/phase12}"
profile_artifact="${artifact_root}/load-${profile}"
edge_port="${MULTI_EDGE_PORT:-3544}"
compose_files="--file compose.multi.yaml --file compose.qualification.yaml"
sampler_name="${project}-sampler"
sampler_started=0
stats_pid=""

compose() {
  MULTI_EDGE_PORT="$edge_port" \
  QUALIFICATION_ARTIFACT_DIR="$artifact_root" \
  COMPOSE_PROGRESS=plain \
    docker compose --project-name "$project" $compose_files "$@"
}

cleanup() {
  stop_collectors
  # `docker compose run --name` containers are not always removed by
  # `compose down` when a previous qualification process was interrupted.
  # Remove the profile-scoped sampler explicitly so every rerun starts clean.
  docker rm -f "$sampler_name" >/dev/null 2>&1 || true
  compose --profile qualification down --volumes --remove-orphans
}

stop_collectors() {
  if [ -n "$stats_pid" ]; then
    kill "$stats_pid" 2>/dev/null || true
    wait "$stats_pid" 2>/dev/null || true
    stats_pid=""
  fi
  if [ "$sampler_started" -eq 1 ]; then
    docker stop --time 10 "$sampler_name" >/dev/null 2>&1 || true
    docker rm "$sampler_name" >/dev/null 2>&1 || true
    sampler_started=0
  fi
}

trap cleanup EXIT INT TERM
mkdir -p "$profile_artifact"
chmod 0777 "$artifact_root" "$profile_artifact"
cleanup

compose up --build --detach --wait nginx || exit 1

compose --profile qualification run --rm --no-deps qualification-client \
  node scripts/qualification-metrics.mjs \
  "/evidence/load-${profile}/metrics-before.json" || exit 1

compose --profile qualification build artillery || exit 1
compose --profile qualification run --detach --no-deps \
  --name "$sampler_name" \
  qualification-client \
  node scripts/qualification-sampler.mjs \
  "/evidence/load-${profile}/samples.ndjson" >/dev/null || exit 1
sampler_started=1

container_ids="$(compose ps --quiet)"
if [ -n "$container_ids" ]; then
  docker stats --format '{{json .}}' $container_ids \
    > "${profile_artifact}/docker-stats.ndjson" &
  stats_pid=$!
fi

compose --profile qualification run --rm --no-deps \
  -e LOAD_PROFILE="$profile" \
  artillery run \
  --output "/evidence/load-${profile}/artillery.json" \
  cluchess-load.ts
artillery_status=$?
stop_collectors

compose --profile qualification run --rm --no-deps qualification-client \
  node scripts/qualification-metrics.mjs \
  "/evidence/load-${profile}/metrics-load-end.json"
load_metrics_status=$?

validation_status=1
if [ -f "${profile_artifact}/artillery.json" ]; then
  compose --profile qualification run --rm --no-deps qualification-client \
    node scripts/validate-qualification-report.mjs \
    "/evidence/load-${profile}/artillery.json" \
    "$profile" \
    "/evidence/load-${profile}/validation.json" \
    "/evidence/load-${profile}/samples.ndjson" \
    "/evidence/load-${profile}/metrics-load-end.json"
  validation_status=$?
fi

compose --profile qualification run --rm --no-deps qualification-client \
  node scripts/qualification-wait-for-drain.mjs
drain_status=$?

compose --profile qualification run --rm --no-deps qualification-client \
  node scripts/qualification-audit.mjs \
  "/evidence/load-${profile}/correctness-audit.json"
audit_status=$?

compose --profile qualification run --rm --no-deps qualification-client \
  node scripts/qualification-metrics.mjs \
  "/evidence/load-${profile}/metrics-after.json"
metrics_status=$?

docker compose version > "${profile_artifact}/docker-compose-version.txt"
docker version --format '{{json .}}' > "${profile_artifact}/docker-version.json"
git rev-parse HEAD > "${profile_artifact}/application-commit.txt"
compose config > "${profile_artifact}/compose-rendered.yaml"
mkdir -p "${profile_artifact}/retained-config"
cp backend/load-tests/cluchess-load.ts \
  backend/load-tests/processor.mjs \
  backend/load-tests/package-lock.json \
  backend/observability/grafana/dashboards/cluchess-overview.json \
  backend/observability/alerts.yml \
  "${profile_artifact}/retained-config/"
chmod -R a+rX "$profile_artifact"

if [ "$artillery_status" -ne 0 ] ||
  [ "$load_metrics_status" -ne 0 ] ||
  [ "$validation_status" -ne 0 ] ||
  [ "$drain_status" -ne 0 ] ||
  [ "$audit_status" -ne 0 ] ||
  [ "$metrics_status" -ne 0 ]; then
  compose logs --no-color --tail 500 > "${profile_artifact}/compose.log"
  exit 1
fi

echo "Phase 12 ${profile} load qualification passed"
