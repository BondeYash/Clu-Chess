# ADR 0007: Leaderless, idempotent background jobs

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** G — Background-job ownership

## Context

Queue cleanup, reservation recovery, join deadlines, chess clocks, disconnect grace, Redis reconstruction, and retention must continue when an instance disappears. A single elected scheduler adds a failure mode and does not improve correctness because every durable transition already needs database guards.

## Decision

Every application instance runs the same bounded jobs. Jobs are safe to overlap and correctness never depends on one instance retaining leadership.

PostgreSQL-backed work uses:

- indexed due-time/status queries;
- bounded batches;
- `FOR UPDATE SKIP LOCKED` where rows can be claimed directly;
- status/version predicates on every transition;
- short transactions;
- retry with jitter for serialization/deadlock/transient dependency failures.

Redis-only cleanup uses idempotent Lua scripts that compare the expected state/value before mutation. An optional short per-job Redis lease may reduce duplicate scanning later, but it is an optimization only; losing the lease never prevents another instance from repairing state.

In-process timers are latency optimizations. Periodic jobs are the recovery guarantee.

## Job catalog and initial cadence

| Job                               |             Initial cadence |                      Batch | Correctness guard                                                      |
| --------------------------------- | --------------------------: | -------------------------: | ---------------------------------------------------------------------- |
| Match backlog drain               | 250 ms when queue non-empty | pairs until bounded budget | atomic `try_match.lua`                                                 |
| Stale queue sweep                 |                         5 s |           200 members/mode | presence + queue-member compare/remove                                 |
| Reservation/allocation reconcile  |                         5 s |                        100 | `match_id`, active assignments, reservation compare                    |
| Join deadline sweep               |                         1 s |                  100 games | row lock + status/version + `join_deadline_at`                         |
| Clock deadline sweep              |                         1 s |                  100 games | ADR 0003 recomputation under row lock                                  |
| Disconnect grace sweep            |                         1 s |          100 players/games | row lock + per-socket presence + durable `grace_deadline_at` + version |
| Active-game/Redis drift reconcile |                        15 s |      100 assignments/games | PostgreSQL truth + compare/set/delete                                  |
| Revoked-session Redis rebuild     |         startup, then 5 min |               500 sessions | durable `revoked_at` and token horizon                                 |
| Expired session cleanup           |                         1 h |               500 sessions | retention predicate + FK safety                                        |
| Old command/idempotency cleanup   |                         1 h |                   500 rows | retention horizon                                                      |

Cadences are configuration values and may be tuned from metrics without changing semantics.

Each job has:

- a stable job name;
- structured start/result/error logs;
- duration, examined, changed, skipped, and failure metrics;
- a per-run time and batch budget;
- graceful-shutdown cancellation;
- no unbounded key scan or table scan.

## Invariants

- Running a job twice has the same durable outcome as running it once.
- Losing the process that owns an in-memory timer cannot suppress the transition.
- Two instances cannot create two durable terminal outcomes or allocations.
- A job never guesses durable truth during PostgreSQL unavailability.

## Consequences

- Some jobs will duplicate harmless reads across instances at MVP scale.
- PostgreSQL indexes on due/status columns are required.
- Redis `SCAN` is used only with bounded cursors; queue ZSets prefer score/range operations.

## Verification

- Run each job concurrently on two instances and compare the final state with one run.
- Kill the instance owning a timer and wait for the periodic sweep.
- Inject PostgreSQL/Redis failures and verify backoff without destructive fallback.
- Load-test job overlap to ensure bounded transaction and event-loop impact.
