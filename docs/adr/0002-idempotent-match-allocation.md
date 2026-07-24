# ADR 0002: Crash-safe and idempotent match allocation

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** B — Crash-safe, idempotent match finalization

## Context

Matchmaking reserves two guests in Redis and then creates their game in PostgreSQL. A process can die after PostgreSQL commits but before Redis is finalized or `match.found` is emitted. Retrying without a durable allocation key could create a second game or requeue a guest who already owns a committed game.

## Decision

The application creates cryptographically random UUIDv4 `matchId` and `gameId` values before calling `try_match.lua`.

The Redis reservation stores:

- `matchId`;
- `gameId`;
- `mode`;
- guest A and guest B;
- both original enqueue scores;
- `createdAt`.

`games` gains a required `match_id uuid` column with a unique constraint. `games.id` is the pre-generated `gameId`.

Game allocation is idempotent by `match_id`:

1. begin a PostgreSQL transaction;
2. look up `games.match_id`;
3. if present, verify the stored game ID, mode, and players match the reservation and return that game;
4. otherwise create the game, players, and active assignments atomically;
5. commit;
6. call `finalize_match.lua`;
7. emit `match.found`.

If an insert races, the losing transaction reads the row by `match_id`, verifies it, and returns the existing allocation.

`finalize_match.lua` changes Redis state only when the reservation still exists and its `gameId`, guest A, and guest B exactly match the supplied values. A repeated valid finalize returns the already-finalized state.

If the reservation expires after PostgreSQL commits, the committed game remains authoritative. Reconciliation restores both guests' Redis active-game/state keys from `active_game_assignments`. On reconnect, recovery emits the same `match.found` or a full `game.snapshot`.

Rollback/recovery is permitted only after PostgreSQL confirms whether a game exists for `match_id` and resolves each guest's durable assignment. An assigned guest is restored to `IN_GAME` for their committed game; an unassigned, present guest may be re-enqueued with the original score. If PostgreSQL is unavailable, the service leaves the reservation/states for reconciliation rather than guessing.

## Invariants

- One `matchId` maps to one `gameId`.
- A retry cannot create a second game for the same match.
- PostgreSQL commit is never undone because Redis finalization failed.
- A guest with a durable active assignment is never re-enqueued.
- `match.found` may be retried or recovered; it is not the source of truth.

## Consequences

- The Redis reservation contains a pre-generated game ID.
- `games.match_id` adds one durable uniqueness constraint and audit handle.
- Redis rollback requires a PostgreSQL truth check.
- Reconciliation handles the commit-before-finalize crash window.

## Verification

- Kill the allocator immediately before PostgreSQL commit: no game exists and eligible guests can be re-enqueued.
- Kill it after commit and before Redis finalize: exactly one game exists and reconciliation restores Redis.
- Run two allocation attempts with one `matchId`: both return the same game.
- Expire the reservation after commit: reconnect still recovers the committed game.
