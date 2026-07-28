# Multi-instance and scaling operations

> **Status:** Phase 10 implemented

## Reproducible two-replica topology

The standard development stack remains:

```bash
docker compose up --build
```

The production-shaped scale topology is:

```bash
docker compose -f compose.multi.yaml up --build
```

It starts:

- two identical production application images, `app-a` and `app-b`;
- one shared PostgreSQL primary;
- one shared Redis primary;
- one Nginx TLS edge at <https://localhost:3443>;
- one-shot JWT and self-signed edge-certificate generators;
- one gated database migration job.

No `.env`, host database, host Redis, manually generated key, or external
account is required. The local edge certificate is intentionally self-signed.

Run the isolated end-to-end topology verification with:

```bash
npm --prefix backend run test:multi:docker
```

The smoke creates sessions routed to both replicas and exercises every HTTP
route plus WSS authentication, heartbeat, queue join/leave, cross-instance
matchmaking, readiness, move delivery, sync, recovery snapshots, resignation,
and session reset. Its project-scoped containers and volumes are removed after
the run.

## Edge and realtime routing

Nginx terminates TLS, forwards `X-Forwarded-Proto: https`, permits WebSocket
upgrade only for an exact local HTTPS origin pattern, and caps request bodies
at 8 KiB. The application independently enforces its exact
`ORIGIN_ALLOWLIST`, secure production transport, and `MAX_WS_BUFFER_BYTES`.

Clients should force Socket.IO WebSocket transport. This removes the need for
affinity after a WebSocket is established. Polling remains a documented
compatibility fallback: Nginx issues an `HttpOnly`, `Secure`
`cluchess_route` cookie and consistently hashes it to one upstream for the
complete Engine.IO polling session.

The public edge returns 404 for `/metrics`. Application containers are not
published directly.

## Cross-instance state

- Personal rooms use `guest:{guestId}` and game rooms use `game:{gameId}`.
- The Socket.IO Redis Streams adapter carries room broadcasts between
  replicas.
- `SOCKET_ADAPTER_STREAM_MAX_LEN` bounds retained stream entries with
  approximate trimming; durable game truth never depends on the stream.
- Presence is a Redis sorted set of `INSTANCE_ID:socketId` members, so the last
  disconnect is computed across the fleet rather than in one process.
- Connection caps are also shared Redis state.
- PostgreSQL remains authoritative for assignments, versions, moves, clocks,
  deadlines, and terminal outcomes.

All background jobs are leaderless. Every replica runs the same bounded,
idempotent work, while PostgreSQL row/version guards and Redis compare/mutate
scripts choose the durable winner. An in-process timer is only a latency
optimization; periodic sweeps on another replica recover missed deadlines.
See [ADR 0007](adr/0007-leaderless-background-jobs.md).

## Graceful drain and rolling restart

On `SIGTERM` or `SIGINT`, an application replica:

1. changes lifecycle state to `draining`, making `/readyz` return 503;
2. rejects new Socket.IO handshakes with `SERVICE_UNAVAILABLE`;
3. rejects new `queue.join` commands while allowing already accepted durable
   game work to finish;
4. emits a local `server.error` reconnect advisory with
   `SERVICE_UNAVAILABLE` and `retryAfterMs`;
5. waits within `DRAIN_TIMEOUT_MS` for tracked HTTP and realtime work;
6. allows `DRAIN_SOCKET_GRACE_MS` for client reconnect initiation;
7. disconnects only this replica's sockets;
8. closes Socket.IO adapter readers, Redis clients, PostgreSQL pools, and
   telemetry through Nest shutdown hooks.

The Redis adapter's recovery state and the authoritative active-game/snapshot
paths let a client land on a different healthy replica. A rolling restart
therefore causes reconnect plus snapshot recovery, not game loss.

Two bounded, instance-labelled gauges expose drain capacity:

- `cluchess_ws_connections{instance=...}`
- `cluchess_in_flight_work{instance=...,kind="http|realtime"}`

## Datastore scale path

### PostgreSQL

Start with one highly available primary. All session mutations, matchmaking,
active-game reads used for correctness, moves, clocks, deadlines, commands,
and reconciliation stay on the primary.

Add read replicas only for explicitly stale-tolerant workloads such as
analytics, historical completed-game views, reporting, and offline exports.
Never route `games/active`, recovery snapshots for active games, matchmaking
eligibility, command replay checks, or deadline decisions to a lagging
replica. Connection pooling may be added in transaction mode only after Prisma
and migration behavior is verified.

Scale the primary vertically and tune indexes/pools before partitioning. If
partitioning becomes necessary, completed game/move history is the first
candidate; active assignments and live game transactions remain colocated.

### Redis

Start with one primary plus replica/failover managed as one logical endpoint.
Keep Lua keys for one operation in a shared hash-tag/key locality. Scale memory
and throughput vertically and tune bounded TTL/stream retention before Redis
Cluster.

Move to Cluster only after measuring a primary/replica bottleneck. Before that
move, audit every Lua script and multi-key command for slot locality. Socket.IO
Streams, presence, connection limits, queue state, and ephemeral game state
may use separate Redis deployments later without changing domain ports or
PostgreSQL truth.

## Failure drills

- Stop one app container; the other remains ready and periodic sweeps continue.
- Send `SIGTERM` to one app; observe readiness 503, reconnect advisory, local
  disconnect, and recovery on the remaining replica.
- Stop Redis; existing committed PostgreSQL state remains intact while
  coordination paths return bounded service errors.
- Stop PostgreSQL; durable mutations fail rather than guessing state from
  Redis.
- Inspect `XLEN cluchess:socket.io` during load to verify retention stays near
  the configured approximate maximum.
