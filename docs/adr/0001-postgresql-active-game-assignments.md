# ADR 0001: PostgreSQL-backed active-game assignments

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** A — One active game per guest

## Context

Redis tracks `user:{guestId}:active-game` for fast matchmaking and reconnect lookups, but Redis is explicitly ephemeral. The original `game_players` constraints prevent the same guest from occupying two slots in one game; they do not prevent that guest from being inserted into two different active games by concurrent match creators.

The one-active-game rule is a correctness invariant and therefore needs a PostgreSQL arbiter.

## Decision

Add an `active_game_assignments` table:

| Column       | Type          | Rule                                                              |
| ------------ | ------------- | ----------------------------------------------------------------- |
| `guest_id`   | `uuid`        | Primary key; FK to `guest_sessions(id)` with `ON DELETE RESTRICT` |
| `game_id`    | `uuid`        | Required FK to `games(id)` with `ON DELETE CASCADE`               |
| `created_at` | `timestamptz` | Required, default `now()`                                         |

Add an index on `game_id`. Do **not** make `game_id` unique because a valid active game has two assignment rows.

Game allocation performs the following in one PostgreSQL transaction:

1. insert or recover the game by its durable `match_id`;
2. insert both `game_players` rows;
3. insert both `active_game_assignments` rows in lexicographic `guest_id` order;
4. commit.

The primary key on `guest_id` makes concurrent allocation of the same guest block and then fail with a unique conflict. Ordering the inserts reduces cross-match deadlock risk. Any assignment conflict rolls back the entire new-game transaction.

Every transition to `COMPLETED`, `ABANDONED`, or `EXPIRED` deletes both durable assignment rows in the **same transaction** as the terminal game update. Redis lookup/state keys are cleared only after that transaction commits.

A deferred raw-SQL constraint trigger validates at commit that:

- each non-terminal allocated game has exactly two active assignments matching its two `game_players`;
- each terminal game has zero active assignments.

`GET /v1/games/active`, enqueue authorization, recovery, and reconciliation query this table first. Redis remains a disposable lookup cache.

## Invariants

- A guest ID can occur in at most one active assignment.
- A non-terminal allocated game has exactly two assignments.
- A terminal game has no assignments.
- Redis loss cannot permit a durable second active game.
- Assignment creation/removal is atomic with the corresponding game transition.

## Consequences

- Game creation and terminal transitions have two additional short writes.
- A raw SQL deferred constraint trigger is required because Prisma cannot express the cross-table count rule.
- Retained `game_players` rows continue to provide historical membership after active assignments are deleted.

## Verification

- Two concurrent transactions attempting to assign one guest to different games result in one commit and one rollback.
- Deleting Redis active-game keys does not permit a second PostgreSQL assignment.
- A terminal transition and assignment deletion commit or roll back together.
- Constraint tests reject a non-terminal game with fewer or more than two assignments.
