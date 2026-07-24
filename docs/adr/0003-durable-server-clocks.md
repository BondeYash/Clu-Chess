# ADR 0003: Durable server-authoritative chess clocks

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** C — Durable, server-authoritative clock model

## Context

Persisting only the last remaining milliseconds is not enough to reconstruct a running clock after a crash. In-memory timers can be lost, duplicated, or delayed and therefore cannot determine a timeout. Disconnect pauses would also let a player stop their clock intentionally.

## Decision

Persist these game fields:

| Field               | Rule                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `white_clock_ms`    | Required non-negative integer; initialized from the time control |
| `black_clock_ms`    | Required non-negative integer; initialized from the time control |
| `turn_started_at`   | Nullable `timestamptz`; non-null while a clock is running        |
| `time_initial_ms`   | Required positive integer                                        |
| `time_increment_ms` | Required non-negative integer                                    |

Each accepted move row also stores `server_received_at`, the authoritative adjudication timestamp used for its clock calculation.

When the game starts, PostgreSQL supplies the authoritative timestamp and `turn_started_at` is set to it. For a move:

1. use one SQL statement with a materialized PostgreSQL timestamp CTE and `SELECT ... FOR UPDATE`, so the adjudication timestamp is captured as the lock request is established rather than after lock wait;
2. lock and re-read the game;
3. reject stale versions normally;
4. calculate `elapsed = max(0, server_received_at - turn_started_at)`;
5. if `elapsed >= mover_clock_ms`, the move is not inserted and timeout wins;
6. otherwise subtract elapsed time, add the increment, switch turns, and set `turn_started_at = server_received_at`;
7. commit the clock update with the move and game version.

The increment is applied only after the move survives the timeout and chess-legality checks.

Clocks continue running during `RECONNECTING`. The 30-second grace controls abandonment; it does not pause time. This prevents disconnect abuse and makes timeout during grace deterministic.

An in-process timer schedules the expected deadline:

`turn_started_at + remaining_clock_ms`

The timer is advisory. On fire, the handler uses the same timestamp-plus-row-lock admission statement, recalculates the clock, and performs a guarded terminal transition only if the same side is still on turn and its clock has expired. A periodic deadline sweep provides the crash/restart backstop.

Terminal transitions set `turn_started_at = NULL` and persist the final clock snapshot. `READY`, `CREATED`, and `WAITING_FOR_PLAYERS` have no running clock.

## Tie-breaking

- `elapsed >= remaining` means the flag has fallen; a move at exact zero is rejected.
- A move admitted to the PostgreSQL lock queue before the deadline can survive scheduler delay because its stored PostgreSQL timestamp is compared with the deadline.
- A move received at or after the deadline loses to timeout even if its handler obtains the row lock first.
- Competing terminal actions are serialized by the game row lock and the transition/version guard.

## Invariants

- The current clock can be reconstructed from PostgreSQL alone.
- Timers never decide truth.
- Process loss cannot grant or remove clock time.
- Disconnecting never pauses a clock.
- A move and its clock update commit atomically.

## Consequences

- All app and PostgreSQL hosts must use UTC and synchronized clocks; PostgreSQL supplies adjudication timestamps.
- Game snapshots calculate the displayed running remainder from persisted clock state and a server timestamp.
- Client clocks are visual estimates only and periodically reconcile with server events/snapshots.

## Verification

- Fake-time unit tests cover increments, exact-zero flag fall, delayed handlers, and reconnect.
- Restart between moves and rebuild timers from PostgreSQL without changing remaining time.
- Race a move before/after the persisted deadline against a timeout job.
- Confirm no move row exists when timeout wins.
