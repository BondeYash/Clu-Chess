# CluChess Backend

Server-authoritative anonymous real-time chess backend, implemented as a
strictly typed NestJS modular monolith.

## Start locally

Docker is the only prerequisite:

```bash
docker compose up --build
```

The command builds the app, creates local Ed25519 signing keys, starts
PostgreSQL 16 and Redis 7, deploys Prisma migrations, and serves:

- liveness: <http://localhost:3000/healthz>
- readiness: <http://localhost:3000/readyz>
- anonymous session lifecycle: <http://localhost:3000/v1/session>
- authenticated Socket.IO v1 namespace: <http://localhost:3000>

No `.env` file, host Node.js installation, database, cache, or signing-key
setup is required.

## Verify

Run the code-quality and unit-test gate in the development container:

```bash
docker compose run --build --rm app npm run verify
```

Run integration tests against isolated Testcontainers-managed PostgreSQL and
Redis containers:

```bash
sh scripts/run-integration-tests.sh
```

Stop the stack while retaining local data:

```bash
docker compose down
```

Explicitly reset only the CluChess development containers and named volumes:

```bash
sh scripts/reset-local-docker.sh
```

See [Architecture.md](Architecture.md), [PLAN.md](PLAN.md), and
[docs/configuration.md](docs/configuration.md) for the normative design and
delivery sequence. Database role separation, safe migrations, rollback, and
restore expectations are in
[docs/database-operations.md](docs/database-operations.md).
Guest-token rotation, revocation, cookies, and retention are documented in
[docs/session-operations.md](docs/session-operations.md).
Socket authentication, protocol boundaries, presence, and multi-instance
delivery are documented in
[docs/realtime-operations.md](docs/realtime-operations.md).
FIFO queueing, durable allocation, failure recovery, and room readiness are
documented in
[docs/matchmaking-operations.md](docs/matchmaking-operations.md).
Authoritative snapshots, move transactions, idempotent recovery, and
board-driven endings are documented in
[docs/gameplay-operations.md](docs/gameplay-operations.md).
