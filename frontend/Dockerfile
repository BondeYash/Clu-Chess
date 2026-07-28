# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
WORKDIR /workspace
COPY packages/protocol-v1/package.json packages/protocol-v1/package-lock.json ./packages/protocol-v1/
RUN npm --prefix packages/protocol-v1 ci
COPY packages/protocol-v1 ./packages/protocol-v1
RUN npm --prefix packages/protocol-v1 run build
COPY frontend/.npmrc frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci \
  && cp frontend/package-lock.json frontend/node_modules/.cluchess-package-lock.json

FROM dependencies AS development
ENV NODE_ENV=development
COPY packages/protocol-v1 ./packages/protocol-v1
COPY frontend ./frontend
USER node
EXPOSE 5173
CMD ["sh", "frontend/scripts/start-development.sh"]

FROM dependencies AS build
ARG FRONTEND_DEPLOYMENT_ENV=production
ARG NEXT_PUBLIC_API_ORIGIN=
ARG NEXT_PUBLIC_APP_ORIGIN=https://cluchess.invalid
ARG NEXT_PUBLIC_BUILD_SHA=container
ARG NEXT_PUBLIC_ENABLE_DEVTOOLS=false
ARG NEXT_PUBLIC_FF_FRONTEND_TELEMETRY=false
ARG NEXT_PUBLIC_FF_LEARN_HUB=false
ARG NEXT_PUBLIC_FF_LESSON_HERO_ART=false
ARG NEXT_PUBLIC_FF_SOUND_EFFECTS=false
ARG NEXT_PUBLIC_PROTOCOL_VERSION=1
ARG NEXT_PUBLIC_SOCKET_ORIGIN=
ENV FRONTEND_DEPLOYMENT_ENV=${FRONTEND_DEPLOYMENT_ENV}
ENV NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN}
ENV NEXT_PUBLIC_APP_ORIGIN=${NEXT_PUBLIC_APP_ORIGIN}
ENV NEXT_PUBLIC_BUILD_SHA=${NEXT_PUBLIC_BUILD_SHA}
ENV NEXT_PUBLIC_ENABLE_DEVTOOLS=${NEXT_PUBLIC_ENABLE_DEVTOOLS}
ENV NEXT_PUBLIC_FF_FRONTEND_TELEMETRY=${NEXT_PUBLIC_FF_FRONTEND_TELEMETRY}
ENV NEXT_PUBLIC_FF_LEARN_HUB=${NEXT_PUBLIC_FF_LEARN_HUB}
ENV NEXT_PUBLIC_FF_LESSON_HERO_ART=${NEXT_PUBLIC_FF_LESSON_HERO_ART}
ENV NEXT_PUBLIC_FF_SOUND_EFFECTS=${NEXT_PUBLIC_FF_SOUND_EFFECTS}
ENV NEXT_PUBLIC_PROTOCOL_VERSION=${NEXT_PUBLIC_PROTOCOL_VERSION}
ENV NEXT_PUBLIC_SOCKET_ORIGIN=${NEXT_PUBLIC_SOCKET_ORIGIN}
COPY packages/protocol-v1 ./packages/protocol-v1
COPY frontend ./frontend
RUN npm --prefix frontend run build

FROM node:${NODE_VERSION}-bookworm-slim AS production
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=5173
ENV TZ=UTC
WORKDIR /app
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /opt/yarn-v1.22.22 \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /workspace/frontend/.next/standalone ./
COPY --from=build --chown=node:node /workspace/frontend/.next/static ./.next/static
COPY --from=build --chown=node:node /workspace/frontend/public ./public
USER node
EXPOSE 5173
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
