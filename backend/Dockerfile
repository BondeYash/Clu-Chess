# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
WORKDIR /workspace/backend
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && chown --recursive node:node /workspace
COPY --chown=node:node backend/package.json backend/package-lock.json ./
COPY --chown=node:node packages/protocol-v1/package.json packages/protocol-v1/package-lock.json /workspace/packages/protocol-v1/
RUN npm ci \
  && npm --prefix ../packages/protocol-v1 ci \
  && cp package-lock.json node_modules/.cluchess-package-lock.json

FROM dependencies AS development
ENV NODE_ENV=development
COPY --chown=node:node packages/protocol-v1 /workspace/packages/protocol-v1
COPY --chown=node:node backend /workspace/backend
USER node
CMD ["npm", "run", "start:dev"]

FROM dependencies AS build
COPY --chown=node:node packages/protocol-v1 /workspace/packages/protocol-v1
COPY --chown=node:node backend /workspace/backend
RUN npm run build \
  && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS production
ENV NODE_ENV=production
ENV TZ=UTC
WORKDIR /app/backend
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /opt/yarn-v1.22.22 \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /workspace/backend/dist ./dist
COPY --from=build --chown=node:node /workspace/packages/protocol-v1/dist /app/packages/protocol-v1/dist
COPY --from=build --chown=node:node /workspace/backend/node_modules /app/node_modules
COPY --from=build --chown=node:node /workspace/backend/package.json ./
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "./dist/instrumentation.js", "./dist/main.js"]
