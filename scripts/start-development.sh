#!/bin/sh
set -eu

if ! cmp -s package-lock.json node_modules/.cluchess-package-lock.json; then
  npm ci
  cp package-lock.json node_modules/.cluchess-package-lock.json
fi

npm run prisma:generate
exec npm run start:dev
