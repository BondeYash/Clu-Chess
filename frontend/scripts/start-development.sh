#!/bin/sh
set -eu

cd /workspace/frontend

if ! cmp -s package-lock.json node_modules/.cluchess-package-lock.json; then
  npm ci
  cp package-lock.json node_modules/.cluchess-package-lock.json
fi

exec npm run dev
