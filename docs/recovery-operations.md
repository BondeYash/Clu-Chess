# Recovery and dependency operations

Phase 9 makes PostgreSQL the recovery path for browser refreshes, reconnects,
lost Socket.IO events, Redis loss, and application restarts. Redis remains an
ephemeral accelerator and coordination store.

## Recovery interfaces

Both HTTP endpoints require the guest JWT through either
`Authorization: Bearer <token>` or the configured HTTP-only session cookie.

- `GET /v1/games/active` reads `active_game_assignments` and returns
  `{ gameId, correlationId }`. A Redis active-game value is inspected only to
  detect and repair drift; it never determines the response.
- `GET /v1/games/:id/snapshot` authorizes against durable `game_players`, reads
  the game, players, ordered moves, and database clock timestamp in a
  repeatable-read transaction, and returns the flattened `game.snapshot`
  payload with `gameId`, `gameVersion`, and `correlationId`.
- `game.sync` accepts optional `gameId` and `gameVersion`, refreshes socket
  presence best-effort, joins the authorized `game:{gameId}` room, and always
  returns a complete snapshot.

Authoritative reads best-effort restore:

- `user:{guestId}:active-game`;
- `user:{guestId}:state=IN_GAME`;
- `game:{gameId}:snapshot`, containing both members' public views;
- live `game:{gameId}:grace:{guestId}` deadlines.

Snapshot cache writes use `SNAPSHOT_CACHE_TTL_MS`. Cache read or write failure
does not fail a PostgreSQL recovery read.

## Leaderless reconciliation

Every application replica runs bounded, idempotent jobs. Duplicate inspection
is expected.

| Job                         | Durable/ephemeral repair                                                                  | Bound                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Match drain/sweep/reconcile | stale queue members, stuck reservations, committed games missing Redis finalization       | `JOB_BATCH_SIZE`                                                   |
| Active drift                | missing/corrupt active-game, user-state, snapshot, and grace keys; stale active-game keys | indexed `(updated_at,id)` database cursor plus Redis `SCAN` cursor |
| Game deadline               | join, clock, and reconnect-grace deadlines                                                | indexed due query, `JOB_BATCH_SIZE`                                |
| Session maintenance         | revocation reconstruction and retained expired-session cleanup                            | durable cursor, `JOB_BATCH_SIZE`                                   |

Active drift runs on startup and every `JOB_ACTIVE_DRIFT_MS`. Its writes are
idempotent sets or compare-and-delete operations. PostgreSQL constraints also
prevent a terminal game from committing with active assignments. Therefore two
replicas can reconcile the same game without changing its durable result or
deleting a newer Redis assignment.

Each repair emits a structured record with `job`, `repair`, `gameId` and/or
`guestSessionId`. Run outcomes and failures are exported through:

- `cluchess_reconciliation_runs_total{job,outcome}`;
- `cluchess_reconciliation_repairs_total{job,kind}`;
- `cluchess_cleanup_failures_total{job}`;
- `cluchess_realtime_adapter_degraded`;
- `cluchess_realtime_local_fallback_total{event}`;
- `cluchess_recovery_cache_reads_total{cache,result}`.

`GET /metrics` emits Prometheus text. In production the application permits
only loopback requests; the deployment proxy must keep the route internal.

## Dependency behavior

### Redis unavailable

- Readiness returns `503`; liveness remains `200`.
- New HTTP/socket authentication fails closed because revocation cannot be
  checked.
- Matchmaking returns retryable `SERVICE_UNAVAILABLE`.
- An already authenticated socket can still commit a move or terminal command
  to PostgreSQL. Rate limiting, cache cleanup, and presence refresh fail open or
  best-effort for these durable commands.
- Local socket delivery remains active while cross-instance fan-out is
  unavailable. Ack identifiers, monotonic versions, and `game.sync` converge
  clients after Redis returns.
- Startup/periodic reconciliation or the next recovery read reconstructs
  application keys.

### PostgreSQL unavailable

- Readiness returns `503`; liveness remains `200`.
- Durable commands return retryable `SERVICE_UNAVAILABLE`; a move failure is a
  `move.rejected` acknowledgment.
- No `move.accepted` or terminal event is produced before a successful commit.
- Clients retry with the same `clientMoveId`/`eventId`, then synchronize if the
  outcome is uncertain.

### Adapter unavailable

Same-instance delivery remains active. Cross-instance recipients can observe a
version gap or ack timeout and request a full snapshot. Adapter degradation and
local fallback are visible in metrics.

## Docker failure drills

The standard stack supplies every external dependency:

```sh
docker compose up --build
```

Redis disposal:

```sh
docker compose exec redis redis-cli FLUSHDB
curl -fsS http://localhost:3000/readyz
```

After Redis is available, call `game.sync` or the snapshot endpoint and verify
the active-game and snapshot keys reappear.

Temporary Redis outage:

```sh
docker compose pause redis
curl -fsS http://localhost:3000/healthz
docker compose unpause redis
```

Temporary PostgreSQL outage:

```sh
docker compose pause postgres
curl -fsS http://localhost:3000/healthz
docker compose unpause postgres
```

During either drill, `/healthz` stays live and `/readyz` fails. Do not remove
Compose volumes unless intentional data reset is desired.

## Executable evidence

`test/integration/recovery.spec.ts` covers HTTP authorization and membership,
refresh after `FLUSHDB`, cache reconstruction, corrupt/stale key repair,
concurrent reconciliation, terminal snapshot recovery after grace, Redis
bypass/restoration, Redis-down durable moves, PostgreSQL-down closed move
failure, and metrics.

Related evidence:

- `matchmaking.spec.ts`: database commit before Redis finalize;
- `gameplay.spec.ts`: duplicate identifiers, transaction serialization, and
  durable move replay;
- `realtime.spec.ts`: multi-instance room delivery, multi-tab presence,
  reconnect snapshot, same-instance adapter fallback, and versioned acks;
- `game-lifecycle.spec.ts`: startup timer reconstruction, deadline/grace
  adjudication, and repeatable terminal cleanup;
- `session.spec.ts`: revocation reconstruction plus Redis/PostgreSQL failure;
- `health.spec.ts`: dependency-aware readiness and independent liveness.
