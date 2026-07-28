#!/bin/sh
set -eu

backend_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repository_directory=$(CDPATH= cd -- "$backend_directory/.." && pwd)
image_name=${1:-cluchess:security-scan}
gitleaks_image=ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
trivy_image=aquasec/trivy:0.72.0@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f

docker build \
  --file "$backend_directory/Dockerfile" \
  --target production \
  --tag "$image_name" \
  "$repository_directory"

docker run --rm \
  --volume "$repository_directory:/repo:ro" \
  "$gitleaks_image" \
  dir /repo --config /repo/.gitleaks.toml --no-banner --redact

docker run --rm \
  --volume "$repository_directory:/workspace:ro" \
  --volume cluchess-trivy-cache:/root/.cache/trivy \
  "$trivy_image" \
  fs \
  --exit-code 1 \
  --ignore-unfixed \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL \
  --skip-dirs .git \
  --skip-dirs coverage \
  --skip-dirs dist \
  --skip-dirs node_modules \
  /workspace

docker run --rm \
  --volume "$repository_directory:/workspace:ro" \
  --volume cluchess-trivy-cache:/root/.cache/trivy \
  "$trivy_image" \
  fs \
  --format json \
  --quiet \
  --scanners license \
  --skip-dirs .git \
  --skip-dirs coverage \
  --skip-dirs dist \
  /workspace |
  node "$backend_directory/scripts/validate-license-report.mjs"

docker run --rm \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume cluchess-trivy-cache:/root/.cache/trivy \
  "$trivy_image" \
  image \
  --format json \
  --ignore-unfixed \
  --quiet \
  --scanners vuln,secret \
  --severity HIGH,CRITICAL \
  "$image_name" |
  node "$backend_directory/scripts/validate-trivy-report.mjs"

docker run --rm --read-only --tmpfs /tmp:size=16m "$image_name" node --version

if docker run --rm "$image_name" sh -c 'command -v npm || command -v npx || command -v yarn || command -v corepack'; then
  echo 'Production image contains a package manager' >&2
  exit 1
fi
