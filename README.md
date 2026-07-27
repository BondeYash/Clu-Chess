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
- Prometheus metrics: <http://localhost:3000/metrics>
- anonymous session lifecycle: <http://localhost:3000/v1/session>
- authenticated recovery: <http://localhost:3000/v1/games/active>
- authenticated Socket.IO v1 namespace: <http://localhost:3000>

No `.env` file, host Node.js installation, database, cache, or signing-key
setup is required.

Start the production-shaped two-replica/WSS topology:

```bash
docker compose -f compose.multi.yaml up --build
```

To start the complete two-replica observability topology (Prometheus, Grafana,
Tempo, and the OpenTelemetry Collector) with no manual environment setup:

```bash
docker compose -f compose.multi.yaml -f compose.observability.yaml up --build
```

Grafana is then available at `http://localhost:3001` and Prometheus at
`http://localhost:9090`. The public HTTPS edge continues to return `404` for
`/metrics`; Prometheus uses the generated internal bearer token directly.

It serves the self-signed local HTTPS edge at
<https://localhost:3443>. PostgreSQL, Redis, migrations, JWT keys, and the TLS
certificate are all Docker-managed.

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

Run the isolated two-replica Nginx/WSS smoke, which exercises every HTTP route
and the complete realtime game flow:

```bash
npm run test:multi:docker
```

Validate Prometheus alerts, alert exercises, dashboards, and the observability
Compose model:

```bash
npm run test:observability:docker
```

Build and scan the exact production image, dependencies, licenses, repository
secrets, and container configuration:

```bash
npm run test:security:docker
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
Durable deadlines, resignation, disconnect grace, no-shows, and non-move
terminal cleanup are documented in
[docs/game-lifecycle-operations.md](docs/game-lifecycle-operations.md).
Refresh/reconnect recovery, leaderless drift repair, metrics, and Docker
dependency drills are documented in
[docs/recovery-operations.md](docs/recovery-operations.md).
Multi-replica routing, graceful drain, rolling restarts, and datastore scaling
are documented in
[docs/scaling-operations.md](docs/scaling-operations.md).
Importable HTTP and Socket.IO Postman assets are in [postman](postman/README.md).

Security controls, telemetry, dashboards, alerts, and response procedures are
documented in [docs/security-operations.md](docs/security-operations.md),
[docs/observability-operations.md](docs/observability-operations.md), and
[docs/observability-runbooks.md](docs/observability-runbooks.md).
