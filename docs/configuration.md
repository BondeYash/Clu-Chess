# CluChess Configuration Contract

> **Status:** Implemented through Phase 11
> **Goal:** No manual local environment or external-service setup

## 1. Zero-touch local workflow

Phase 1 must make this the complete local startup flow:

```bash
docker compose up --build
```

That command will:

1. build the NestJS development container;
2. start PostgreSQL 16+ in Docker;
3. start Redis 7+ in Docker;
4. run a one-shot Docker key-generation service when local Ed25519 keys do not exist;
5. apply development Prisma migrations through a one-shot migration service;
6. start the application after healthy dependencies and successful migration;
7. leave optional edge and observability services disabled until their planned
   hardening phases.

No developer must install PostgreSQL or Redis directly. Datastore integration
tests use isolated Testcontainers-managed PostgreSQL and Redis containers while
retaining Docker as the only host prerequisite.

No committed file contains a production secret. Local-only generated files and volumes are ignored by Git.

## 2. Local secrets and defaults

Docker Compose supplies safe development-only database/Redis credentials and service URLs. A one-shot `keygen` container writes an Ed25519 private/public key pair into a named Docker volume mounted read-only by the app.

The app reads signing material from files:

- `JWT_PRIVATE_KEY_FILE=/run/secrets/cluchess/jwt-private.pem`
- `JWT_PUBLIC_KEYS_DIR=/run/secrets/cluchess/public`
- `JWT_KID=local-dev-1`

Raw private key values are not placed in `.env`, Compose YAML, image layers, command arguments, or logs.

An optional untracked `.env.local` may override non-secret developer settings, but it is never required for the standard workflow.

If another local process already owns port `3000`, `APP_PORT=3300 docker compose
up --build` changes only the host-side port mapping. The application still
listens on its validated `PORT=3000` inside Docker.

## 3. Configuration matrix

All duration values use explicit millisecond or second suffixes. Startup validation rejects absent, malformed, unsafe, or contradictory values.

| Variable                               | Local default              | Test default              | Production rule                                                   |
| -------------------------------------- | -------------------------- | ------------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`                             | `development`              | `test`                    | `production`                                                      |
| `PORT`                                 | `3000`                     | allocated                 | platform supplied or `3000`                                       |
| `DATABASE_URL`                         | Compose runtime-role URL   | Testcontainers URL        | required runtime secret                                           |
| `MIGRATION_DATABASE_URL`               | Compose migration-role URL | Testcontainers URL        | migration job secret only                                         |
| `DATABASE_POOL_MAX`                    | `20`                       | `5`                       | required, initially `20–40`                                       |
| `DATABASE_TX_TIMEOUT_MS`               | `3000`                     | `3000`                    | required                                                          |
| `REDIS_URL`                            | Compose Redis URL          | Testcontainers URL        | required secret/reference                                         |
| `TRUST_PROXY_HOPS`                     | `0` (direct app)           | `0` or topology supplied  | number of trusted proxy hops; set `1` behind the bundled Nginx/LB |
| `JWT_PRIVATE_KEY_FILE`                 | generated volume path      | generated test key path   | required mounted secret                                           |
| `JWT_PUBLIC_KEYS_DIR`                  | generated volume directory | generated test directory  | required mounted key set                                          |
| `JWT_KID`                              | `local-dev-1`              | `test-1`                  | required unique key ID                                            |
| `JWT_TTL_SECONDS`                      | `43200`                    | `43200`                   | default `43200`                                                   |
| `JWT_CLOCK_SKEW_SECONDS`               | `30`                       | `30`                      | default `30`                                                      |
| `SESSION_COOKIE_ENABLED`               | `true`                     | `true`                    | policy supplied                                                   |
| `SESSION_COOKIE_NAME`                  | `cluchess_guest`           | `cluchess_guest`          | stable non-secret name                                            |
| `SESSION_RETENTION_DAYS`               | `30`                       | `30`                      | minimum `1`                                                       |
| `ORIGIN_ALLOWLIST`                     | `http://localhost:5173`    | test origin               | required HTTPS origins                                            |
| `TIME_INITIAL_MS`                      | `300000`                   | scenario supplied         | default `300000`                                                  |
| `TIME_INCREMENT_MS`                    | `2000`                     | scenario supplied         | default `2000`                                                    |
| `JOIN_DEADLINE_MS`                     | `20000`                    | shorter fake-time config  | default `20000`                                                   |
| `GRACE_MS`                             | `30000`                    | shorter fake-time config  | default `30000`                                                   |
| `RESERVATION_TTL_MS`                   | `30000`                    | shorter integration value | default `30000`                                                   |
| `PRESENCE_TTL_MS`                      | `45000`                    | shorter integration value | default `45000`                                                   |
| `QUEUE_GUARD_TTL_MS`                   | `120000`                   | shorter integration value | default `120000`                                                  |
| `QUEUE_MAX_WAIT_MS`                    | `120000`                   | shorter integration value | default `120000`                                                  |
| `MATCH_STATE_TTL_MS`                   | `3600000`                  | shorter integration value | default `3600000`                                                 |
| `SNAPSHOT_CACHE_TTL_MS`                | `60000`                    | shorter integration value | default `60000`                                                   |
| `MAX_WS_BUFFER_BYTES`                  | `8192`                     | `8192`                    | maximum `8192` for v1                                             |
| `MAX_SOCKET_SEND_QUEUE_PACKETS`        | `64`                       | `64`                      | bounded, minimum `1`                                              |
| `DRAIN_TIMEOUT_MS`                     | `15000`                    | `1000`                    | default `15000`                                                   |
| `DRAIN_SOCKET_GRACE_MS`                | `500`                      | scenario supplied         | default `500`                                                     |
| `SOCKET_PING_INTERVAL_MS`              | `25000`                    | scenario supplied         | default `25000`                                                   |
| `SOCKET_PING_TIMEOUT_MS`               | `20000`                    | scenario supplied         | default `20000`                                                   |
| `SOCKET_RECOVERY_MAX_DISCONNECTION_MS` | `120000`                   | `5000`                    | bounded, default `120000`                                         |
| `SOCKET_ADAPTER_STREAM_MAX_LEN`        | `10000`                    | `10000`                   | bounded retention target                                          |
| `LOG_LEVEL`                            | `debug`                    | `warn`                    | `info` unless overridden                                          |
| `OTEL_ENABLED`                         | `false`                    | `false`                   | `true`                                                            |
| `OTEL_EXPORTER_OTLP_ENDPOINT`          | Compose profile URL        | test collector            | required when OTel enabled                                        |
| `OTEL_TRACE_SAMPLE_RATIO`              | `1`                        | `1`                       | `1` with tail sampling                                            |
| `METRICS_ENABLED`                      | `true`                     | `true`                    | `true`                                                            |
| `METRICS_BEARER_TOKEN_FILE`            | generated volume path      | not required              | mounted secret path                                               |
| `INSTANCE_ID`                          | generated hostname         | generated                 | platform/hostname supplied                                        |
| `ALLOW_INSECURE_LOCAL_PRODUCTION`      | `false`                    | `false`                   | must remain `false`                                               |

## 4. Rate-limit configuration

| Variable                      | Default |
| ----------------------------- | ------: |
| `RL_SESSION_CREATE_LIMIT`     |    `10` |
| `RL_SESSION_CREATE_WINDOW_MS` | `60000` |
| `RL_SESSION_RENEW_LIMIT`      |    `30` |
| `RL_SESSION_RENEW_WINDOW_MS`  | `60000` |
| `RL_SESSION_RESET_LIMIT`      |    `10` |
| `RL_SESSION_RESET_WINDOW_MS`  | `60000` |
| `RL_SESSION_GET_LIMIT`        |    `60` |
| `RL_SESSION_GET_WINDOW_MS`    | `60000` |
| `RL_QUEUE_LIMIT`              |     `5` |
| `RL_QUEUE_WINDOW_MS`          | `10000` |
| `RL_MOVE_LIMIT`               |    `10` |
| `RL_MOVE_WINDOW_MS`           |  `1000` |
| `RL_SYNC_LIMIT`               |   `120` |
| `RL_SYNC_WINDOW_MS`           | `60000` |
| `RL_CONNECTIONS_PER_IP`       |    `20` |

Rate-limit policies define their dependency behavior:

- authentication/revocation checks fail closed when Redis cannot be consulted;
- anti-abuse counters may fail open briefly for already-authenticated gameplay so Redis loss does not corrupt or freeze a durable game;
- session creation and matchmaking return `SERVICE_UNAVAILABLE` when their Redis correctness/coordination path is unavailable.

Session-create counters use only a SHA-256 digest of the transient client
address and expire with the configured window. No IP address or device
fingerprint is written to PostgreSQL.

## 5. Background-job configuration

| Variable                       |   Default |
| ------------------------------ | --------: |
| `JOB_MATCH_DRAIN_MS`           |     `250` |
| `JOB_QUEUE_SWEEP_MS`           |    `5000` |
| `JOB_RESERVATION_RECONCILE_MS` |    `5000` |
| `JOB_DEADLINE_SWEEP_MS`        |    `1000` |
| `JOB_ACTIVE_DRIFT_MS`          |   `15000` |
| `JOB_REVOCATION_REBUILD_MS`    |  `300000` |
| `JOB_SESSION_CLEANUP_MS`       | `3600000` |
| `JOB_METRICS_REFRESH_MS`       |   `10000` |
| `JOB_BATCH_SIZE`               |     `100` |

Every value is bounded by validation so an accidental zero/tiny interval cannot busy-loop the process.

## 6. Configuration validation

The Phase 1 config module must:

- parse the process environment once at startup with Zod;
- return a typed immutable config object;
- reject unknown/unsafe production combinations;
- reject non-HTTPS production origins;
- reject missing key files or an active `kid` without a corresponding public key;
- reject TTL relationships that break recovery, such as reservation TTL exceeding user-state TTL;
- redact variables containing credentials, tokens, keys, or URLs with embedded passwords;
- log only a safe configuration summary.

Required relationships:

- `PRESENCE_TTL_MS` is greater than one application heartbeat interval;
- `QUEUE_GUARD_TTL_MS` is greater than `PRESENCE_TTL_MS`;
- `MATCH_STATE_TTL_MS` is greater than `RESERVATION_TTL_MS`;
- retiring JWT verification keys remain mounted for `JWT_TTL_SECONDS + JWT_CLOCK_SKEW_SECONDS`;
- `DRAIN_TIMEOUT_MS` exceeds the database transaction timeout, socket grace,
  and bounded shutdown overhead combined;
- `DRAIN_SOCKET_GRACE_MS` is less than `DRAIN_TIMEOUT_MS`;
- production PostgreSQL URLs contain credentials and `sslmode=require`,
  `verify-ca`, or `verify-full`;
- production Redis URLs use authenticated `rediss://`;
- `ALLOW_INSECURE_LOCAL_PRODUCTION=true` is reserved for the isolated
  production-image Docker smoke topology, is accepted only with the
  `postgres`/`redis` service hosts and localhost origin, and is forbidden in
  real deployments;
- all clocks, grace, and deadline values are positive; increments may be zero.

## 7. Docker persistence and cleanup

Named volumes:

- PostgreSQL data;
- Redis data for local restart convenience;
- generated local JWT keys.

The normal `docker compose down` keeps them. An explicit documented reset command in Phase 1 will remove project-scoped development volumes; it must name those volumes and never target broad Docker/system state.

## 8. Production configuration

Production deployment will be generated from version-controlled manifests/templates:

- managed PostgreSQL and Redis are the only non-containerized runtime dependencies permitted by the architecture;
- credentials and JWT private keys come from a secret manager and are mounted/injected by the platform;
- the metrics bearer token comes from the same secret manager and is mounted as
  a file readable only by the runtime and Prometheus identities;
- migrations run with a separate migration role as a gated job, never in every app replica;
- app replicas use a least-privilege runtime role without schema mutation rights;
- `/metrics` is routed only on the internal network;
- readiness controls load-balancer routing;
- no operator hand-edits files inside a running container.

Until production infrastructure is selected, Phase 1–12 remain fully reproducible with Docker and require no manually provisioned external service.

See [`database-operations.md`](database-operations.md) for grants,
expand/contract migration rules, rollback policy, and backup/restore
expectations.
