# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /load
RUN chown node:node /load

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY cluchess-load.ts processor.mjs ./

USER node
ENTRYPOINT ["npx", "--no-install", "artillery"]
