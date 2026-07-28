# Matchmaking and Allocation Operations

> **Status:** Phase 6 implementation contract
> **Durable authority:** PostgreSQL active assignments and games

## Runtime flow

`queue.join` first checks PostgreSQL eligibility and the live Redis presence
set. The enqueue Lua script then preserves the guest's original sorted-set
score on retries and attempts an atomic FIFO match. A reservation contains two
distinct guests plus server-generated match and game IDs.

Game allocation runs in one PostgreSQL transaction. It locks both guest
sessions in stable order, verifies eligibility and active assignments, inserts
one game with exactly two opposite-color players, and claims both active
assignments. Redis is finalized only after that transaction commits.

Every app replica runs the same bounded, overlap-protected jobs:

- queue drain every `JOB_MATCH_DRAIN_MS`;
- stale/max-wait sweep every `JOB_QUEUE_SWEEP_MS`;
- reservation and committed-game reconciliation every
  `JOB_RESERVATION_RECONCILE_MS`.

The jobs are leaderless by design. Redis scripts and PostgreSQL constraints
make concurrent execution safe.

## Redis working set

| Key pattern                   | Purpose                               | Lifetime                  |
| ----------------------------- | ------------------------------------- | ------------------------- |
| `mm:queue:blitz`              | FIFO guests by enqueue epoch          | swept explicitly          |
| `mm:queued:{guestId}`         | queue guard and selected mode         | `QUEUE_GUARD_TTL_MS`      |
| `user:{guestId}:state`        | queue/reservation/game state hint     | `MATCH_STATE_TTL_MS`      |
| `user:{guestId}:active-game`  | active durable game hint              | cleared at terminal phase |
| `match:{matchId}:reservation` | pair, fair scores, IDs, creation time | `RESERVATION_TTL_MS`      |
| `presence:{guestId}`          | unexpired socket members              | heartbeat managed         |

Lua sources are copied into `dist` during `npm run build`, so the production
image has the same scripts as development. Commands execute by SHA and reload
once on Redis `NOSCRIPT`.

The MVP uses the Architecture v1 single-node key names. A future Redis Cluster
migration can move this working set under the documented `{mm}` hash tag
without changing service contracts.

## Failure and recovery rules

- PostgreSQL is always checked before enqueue, even if Redis was flushed.
- A database failure before allocation commit releases the reservation and
  requeues only guests that remain eligible and present, retaining their
  original scores.
- A commit followed by Redis failure keeps the durable game. Reconciliation
  finds it by match ID or active assignment and restores both active-game
  hints.
- Concurrent allocators cannot reuse a guest because the transaction locks
  guests and the `active_game_assignments` primary key is authoritative.
- Malformed, expired, or foreign reservations are never finalized or used to
  mutate a queue.
- Redis loss pauses matchmaking, but existing durable games remain recoverable
  through `game.sync`.

## Room readiness

`game.ready` authorizes PostgreSQL membership before joining
`game:{gameId}`. The player's `joined_at` and `connected_at` timestamps are
persisted transactionally. The game remains `WAITING_FOR_PLAYERS` after the
first distinct player and changes to `READY` with one version increment only
after both players are ready. Phase 7 then locks and changes it to
`IN_PROGRESS` with a second version increment, persists the authoritative
clock start once, and emits `game.started` after commit. Repeated readiness is
idempotent, including a retry carrying the pre-transition version.

## Verification

Run the static, unit, coverage, and production build gate:

```bash
docker compose run --build --rm app npm run verify
```

Run the disposable real-PostgreSQL/Redis and two-instance realtime suite:

```bash
sh backend/scripts/run-integration-tests.sh
```

The integration audit covers SHA reload, TTLs, FIFO scores, stale cleanup,
rollback eligibility, self-match prevention, parallel drains, durable
idempotency, crash recovery, Redis loss, cross-instance delivery, and exact
two-player allocation.
