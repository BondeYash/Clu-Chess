# Authoritative Gameplay Operations

> **Status:** Phase 7 implementation contract
> **Protocol authority:** [`protocol-v1.md`](protocol-v1.md)

## Durable authority

PostgreSQL is the authority for the position, ordered move history, clocks,
turn, game status, result, termination, and version. `game.sync` reads a
repeatable PostgreSQL snapshot containing the game, both players, and moves
ordered by ply. It then computes the live clock view at a timestamp obtained
from PostgreSQL.

Snapshot cache keys use `game:{gameId}:snapshot` and are disposable. Gameplay
does not read a cached snapshot as authority, and cache invalidation failure
cannot reject or roll back a committed move.

## Start transition

The first distinct `game.ready` persists player readiness without changing the
game version. The second transitions `WAITING_FOR_PLAYERS → READY` and then
`READY → IN_PROGRESS`, producing versions 1 and 2. The start transaction locks
the game, obtains PostgreSQL `clock_timestamp()`, and persists `started_at` and
`turn_started_at` exactly once. `game.started` is emitted only after commit.

A READY fallback in `move.submit` can perform the start and move transitions in
one transaction after a process interruption. It increments the version twice
and preserves the same event ordering.

## Move transaction

`move.submit` trusts only the guest identity frozen into the authenticated
socket. After strict protocol validation, one PostgreSQL transaction:

1. locks the game row while materializing one database observation timestamp;
2. loads both players and the complete ordered move history;
3. returns the stored response for an existing `(game_id, clientMoveId)`;
4. validates membership, status, color, turn, and expected version;
5. reconstructs the position from initial FEN plus ordered UCI history;
6. admits the move against the durable clock at the database timestamp;
7. validates and applies the move through the chess-engine port;
8. advances FEN, PGN, turn, clocks, and version with an optimistic guard;
9. inserts the unique move row and exact JSON acknowledgement;
10. records a board-driven terminal result and deletes active assignments when
    applicable;
11. commits.

The `moves` uniqueness constraints on `(game_id, client_move_id)` and
`(game_id, ply)` remain final defenses. A raced unique conflict is read back as
the winner’s original acknowledgement.

## Delivery and recovery

After the repository promise returns, Redis snapshot state is invalidated.
Terminal moves also clear both guests’ active-game hints and return their
ephemeral matchmaking states to `IDLE`.

Only then does realtime delivery publish:

1. optional recovery `game.started`;
2. `move.accepted`;
3. optional `game.ended`.

The submitter receives the same authoritative move payload in its
acknowledgement. Delivery is not part of the database transaction. If the
process stops after commit but before emission, retrying the same
`clientMoveId` returns the stored response and `game.sync` returns the
committed move.

## Stable move rejections

Gameplay maps expected failures to `move.rejected`:

- `GAME_NOT_FOUND`;
- `NOT_A_PLAYER`;
- `GAME_ALREADY_ENDED`;
- `NOT_YOUR_TURN`;
- `STALE_GAME_VERSION`;
- `ILLEGAL_MOVE`;
- `CLOCK_EXPIRED`;
- `IDEMPOTENCY_KEY_REUSED`;
- `SERVICE_UNAVAILABLE` for dependency or corrupt-state failures.

Expired-clock moves never mutate game state. Durable timeout adjudication and
all non-move terminal commands are documented in
[`game-lifecycle-operations.md`](game-lifecycle-operations.md).

## Verification

Run static, unit, coverage, and production build gates:

```bash
docker compose run --build --rm app npm run verify
```

Run disposable real PostgreSQL/Redis and two-instance realtime tests:

```bash
sh backend/scripts/run-integration-tests.sh
```

The integration suite audits exact duplicate replay, simultaneous same-version
submissions, illegal/off-turn/stale/non-member errors, forced transaction
rollback and retry, ordered sync recovery, cross-instance event ordering,
terminal cleanup, contiguous plies, version drift, and a complete checkmate.
