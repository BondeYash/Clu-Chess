# CluChess Backend

Server-authoritative NestJS API and Socket.IO service for anonymous real-time
chess.

This directory is an independent Node.js package. It owns backend source,
Prisma migrations, backend tests, operational scripts, load tests, and the
backend container definition. The only source-level dependency outside this
directory is the versioned contract package at `../packages/protocol-v1`.

From the repository root:

```bash
npm --prefix packages/protocol-v1 ci
npm --prefix backend ci
npm --prefix backend run verify
```

Start the complete application stack from the repository root:

```bash
docker compose up --build
```

Run the isolated backend integration suite:

```bash
sh backend/scripts/run-integration-tests.sh
```

See the root [README](../README.md), [architecture](../Architecture.md), and
[backend delivery plan](../PLAN.md) for the full system contract.
