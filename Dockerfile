# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
WORKDIR /workspace
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && chown node:node /workspace
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
COPY --chown=node:node . .
USER node
CMD ["npm", "run", "start:dev"]

FROM dependencies AS build
COPY --chown=node:node . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS production
ENV NODE_ENV=production
ENV TZ=UTC
WORKDIR /app
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "./dist/instrumentation.js", "./dist/main.js"]
