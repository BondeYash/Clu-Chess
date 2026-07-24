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

No `.env` file, host Node.js installation, database, cache, or signing-key
setup is required.

## Verify

Run the code-quality and unit-test gate in the development container:

```bash
docker compose run --build --rm app npm run verify
```

Run integration tests against isolated PostgreSQL and Redis containers:

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
delivery sequence.
