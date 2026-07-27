# CluChess Backend Implementation Plan

> **Source of truth:** [`Architecture.md`](Architecture.md), approved architecture v1.1
> **Plan status:** Implementation-ready after Phase 0 decisions are approved  
> **Scope:** Complete backend for anonymous sessions, instant matchmaking, server-authoritative real-time chess, recovery, horizontal scaling, security, observability, testing, and deployment  
> **Delivery model:** NestJS modular monolith, PostgreSQL as durable authority, Redis for ephemeral coordination, Socket.IO for realtime delivery

---

## 1. Outcome

Build a production-ready backend in which:

- a visitor can create and renew an anonymous guest identity;
- an authenticated socket can enter a FIFO matchmaking queue;
- exactly two distinct idle guests are atomically assigned to one game with random colors;
- every move is authorized, validated, versioned, committed to PostgreSQL, and only then broadcast;
- retries, duplicate events, concurrent moves, disconnects, crashes, and missed broadcasts converge on one authoritative game state;
- the same behavior holds on one application instance or many;
- health, security, observability, failure recovery, and load-test evidence are present before release.

The plan intentionally builds correctness paths before optimization paths. Redis caches and coordination may improve latency, but no game invariant may rely on Redis alone.

---

## 2. Delivery principles

These rules apply to every phase and pull request.

1. **PostgreSQL decides durable truth.** Games, players, moves, versions, clocks, and terminal results are committed there.
2. **Commit before emit.** No accepted move or terminal result is broadcast before its database transaction commits.
3. **Every state-changing command is idempotent.** Retries reuse the same command identifier and return the original authoritative outcome.
4. **The authenticated guest comes from the server context.** Never trust a `guestId`, color, result, turn, or room membership supplied by the client.
5. **Socket.IO rooms route events; they do not grant access.** Membership is checked against durable game-player data for every game command.
6. **Redis loss may reduce convenience, never correctness.** Matchmaking can pause and caches can miss; accepted games and moves must remain recoverable.
7. **Pure domain logic stays transport- and vendor-independent.** The domain imports neither Socket.IO, Prisma, Redis, nor `chess.js` types.
8. **Contracts are versioned before handlers are written.** Zod schemas are the runtime boundary and the source for inferred TypeScript input/output types.
9. **Correctness tests use real PostgreSQL and Redis.** Mocks are acceptable for unit tests, not for constraints, transactions, Lua scripts, or multi-instance behavior.
10. **Security and telemetry are built into each vertical slice.** The later hardening phase audits and completes them; it does not introduce them for the first time.

---

## 3. Implementation gates to resolve first

`Architecture.md` is authoritative, but the following details are under-specified or need a stronger durable guarantee. Phase 0 must record the final choices as short ADRs and update `Architecture.md` where a decision changes its schema or contract.

> **Resolved 2026-07-24:** Gates A–H are accepted in [`docs/adr/`](docs/adr/). The accepted ADRs and [`docs/protocol-v1.md`](docs/protocol-v1.md) are normative for implementation.

### Gate A — One active game per guest

Redis's `user:{guestId}:active-game` key is not sufficient as the final guarantee, and the current `game_players` schema can contain one guest in multiple different active games.

**Recommended decision:** add a small PostgreSQL `active_game_assignments` table:

- `guest_id` primary key and FK to `guest_sessions`;
- `game_id` FK to `games`;
- two assignment rows inserted in the same transaction as the game and its two players;
- assignments deleted in the same PostgreSQL transaction that makes the game terminal;
- Redis `active-game` remains a lookup cache.

Alternative approaches must still make PostgreSQL reject a double assignment under concurrent match creation.

### Gate B — Crash-safe, idempotent match finalization

A process can crash after creating the PostgreSQL game but before finalizing the Redis reservation. A retry must find the same game rather than create a second one.

**Recommended decision:**

- generate `matchId` and `gameId` before the PostgreSQL transaction;
- persist a unique `match_id` on `games`;
- make game creation an upsert/read-after-conflict operation keyed by `match_id`;
- let the reconciler finalize Redis from the existing database game after a crash;
- make `finalize_match.lua` verify the expected reservation members before changing their state.

### Gate C — Durable, server-authoritative clock model

The current schema stores remaining milliseconds but not enough timing context to reconstruct an exact running clock after a process crash.

**Recommended decision:** persist at least:

- `white_clock_ms` and `black_clock_ms`;
- `turn_started_at` or a persisted `turn_deadline_at`;
- the server timestamp used in each accepted move transaction;
- whether clocks pause during `RECONNECTING`;
- increment application order and flag-fall tie-breaking.

All timeout jobs must be advisory. The terminal timeout transaction re-reads the durable clock state and wins through a status/version guard.

### Gate D — Threefold repetition and engine history

Threefold repetition cannot be determined reliably from only the current FEN. The `ChessEngine` call contract must receive or reconstruct game history.

**Recommended decision:** make the engine adapter reconstruct the position from `initial_fen` plus ordered accepted moves (or load an authoritative PGN), apply the proposal, and evaluate game-over state in that historical context. Keep this behind the `ChessEngine` interface and cover it with adapter tests.

### Gate E — Session renewal and revocation semantics

Define whether more than one JWT for a guest can remain valid after renewal, how `current_jti` is used, and what happens if Redis is unavailable during a denylist check.

The decision must specify:

- rotation behavior for the old `jti`;
- idempotent retry behavior for `/session/renew`;
- reset behavior when Redis or PostgreSQL is unavailable;
- handshake fail-open or fail-closed policy for revocation lookup;
- signing-key rotation overlap using `kid`.

### Gate F — Terminal and reconnection policies

Freeze the user-visible result for:

- one player missing the initial join deadline;
- both players missing the join deadline;
- both players exceeding disconnect grace;
- a clock expiring during the reconnection grace window;
- reset/logout during a game;
- simultaneous resignation, timeout, abandonment, or terminal move races.

Every outcome needs one status, result, termination value, version rule, and cleanup rule.

### Gate G — Background-job ownership

Choose one implementation for queue sweeping, reservation recovery, clock deadlines, grace expiry, and reconciliation:

- idempotent jobs safely run by every instance; or
- a Redis-backed short lease with fencing/compare-and-delete semantics.

Regardless of scheduling, PostgreSQL transaction guards remain the arbiter for durable transitions.

### Gate H — Protocol and acknowledgement contract

Freeze:

- whether the Socket.IO event name and envelope `type` must match;
- acknowledgement success/error shape;
- required identifiers for `queue.join`, `queue.leave`, `game.ready`, `move.submit`, `game.resign`, and `game.sync`;
- timestamp trust rules;
- maximum event size;
- forward-compatibility behavior for unknown protocol versions and fields.

---

## 4. Phase map

| Phase | Name | Depends on | Primary result |
|---|---|---|---|
| 0 | Architecture closure and contracts | — | Correctness-sensitive decisions and frozen v1 contracts |
| 1 | Repository and runtime foundation | 0 | Bootable, testable NestJS service with local infrastructure |
| 2 | Durable persistence foundation | 1 | Migrations, constraints, repositories, and transaction helpers |
| 3 | Anonymous identity and sessions | 2 | Complete guest REST lifecycle and JWT verification |
| 4 | Realtime protocol, authentication, and presence | 3 | Authenticated Socket.IO connection with validated events |
| 5 | Chess and game-domain core | 0–2 | Vendor-isolated chess rules and tested lifecycle transitions |
| 6 | Atomic matchmaking and game allocation | 3–5 | Two guests atomically receive one durable game |
| 7 | Authoritative gameplay transaction | 5–6 | Legal, idempotent, durable moves and game completion |
| 8 | Clocks and non-move terminal paths | 7 | Timeout, resignation, no-show, disconnect, and abandonment |
| 9 | Recovery, reconciliation, and dependency failure | 6–8 | Refresh/reconnect/crash recovery from authoritative state |
| 10 | Multi-instance operation and graceful delivery | 4–9 | Scale-invariant behavior across replicas |
| 11 | Security, observability, and operational hardening | 1–10 | Auditable and supportable production service |
| 12 | End-to-end, failure, and load qualification | 1–11 | Evidence that correctness and performance targets are met |
| 13 | Production release and runbooks | 12 | Safely deployable MVP with rollback and operations guidance |

**MVP feature-complete point:** end of Phase 9.  
**Production-ready point:** end of Phase 13.  
**Horizontal-scale readiness:** implemented in earlier seams and proven in Phases 10 and 12.

---

## 5. Phase-by-phase plan

## Phase 0 — Architecture closure and contract freeze

> **Status:** Complete — accepted 2026-07-24

### Objective

Remove ambiguity from the invariants and public contracts before database migrations and client-facing handlers make those decisions expensive to change.

### Work

- [x] Create `docs/adr/` and record decisions for Gates A–H.
- [x] Define canonical domain enums:
  - game status;
  - player color;
  - result;
  - termination reason;
  - user matchmaking state;
  - protocol error code.
- [x] Define the legal game-state transition table, including which transitions increment `games.version`.
- [x] Define the full v1 REST schemas and status/error responses.
- [x] Define the full v1 WS envelope, event payloads, acknowledgement shape, and error mapping.
- [x] Freeze the v1 event catalog:
  - C→S: `queue.join`, `queue.leave`, `game.ready`, `move.submit`, `game.resign`, `game.sync`, `heartbeat.ping`;
  - S→C: `session.ready`, `queue.joined`, `queue.left`, `match.found`, `game.snapshot`, `game.started`, `move.accepted`, `move.rejected`, `player.disconnected`, `player.reconnected`, `game.ended`, `heartbeat.pong`, `server.error`.
- [x] Specify identifier rules:
  - UUID version and generation owner;
  - `eventId`;
  - `clientMoveId`;
  - matchmaking command IDs;
  - resignation command ID;
  - HTTP `Idempotency-Key`.
- [x] Specify default clock values, pause/resume behavior, increment rules, and timeout race rules.
- [x] Specify engine history input for threefold repetition.
- [x] Specify the durable one-active-game mechanism.
- [x] Specify the crash-recovery key connecting a Redis reservation to one PostgreSQL game.
- [x] Specify session token rotation, renewal idempotency, revocation, key rotation, cookie attributes, and Redis-outage behavior.
- [x] Specify all background jobs, their intervals, overlap behavior, and ownership strategy.
- [x] Turn all environment settings into a documented configuration matrix with local/test/production expectations.
- [x] Update `Architecture.md` if an approved ADR changes its schema or behavior.

### Required artifacts

- [`docs/adr/*.md`](docs/adr/) — eight accepted decision records
- [`docs/protocol-v1.md`](docs/protocol-v1.md) — protocol specification ready to encode in Phase 1
- [`Architecture.md`](Architecture.md) §19 — approved PostgreSQL schema delta
- [`Architecture.md`](Architecture.md) §13/§20 — approved Redis key/Lua input-output contract
- ADRs [0003](docs/adr/0003-durable-server-clocks.md), [0006](docs/adr/0006-game-transitions-and-terminal-races.md), and [0007](docs/adr/0007-leaderless-background-jobs.md) — approved state, clock, and job rules

### Exit criteria

> **Result:** Passed. Gates A–H, schema deltas, protocol, state/clock rules, Redis contracts, and configuration are approved and linked above.

- Every Gate A–H has one approved decision.
- No critical invariant is guaranteed only by an in-memory value or Redis key.
- The database schema can be migrated without known correctness gaps.
- Frontend and backend can implement the same protocol without guessing.

---

## Phase 1 — Repository and runtime foundation

### Objective

Create a reproducible development and CI environment with strict configuration, clean module boundaries, health endpoints, and production-safe process behavior.

### Work

#### Project bootstrap

- [x] Initialize the NestJS application on Node.js 24 LTS with TypeScript `strict: true`.
- [x] Select and lock one package manager; commit its lockfile and runtime version metadata.
- [x] Create the module structure from `Architecture.md`:
  - `session`;
  - `identity`;
  - `matchmaking`;
  - `realtime`;
  - `game`;
  - `chess`;
  - `presence`;
  - `persistence`;
  - `health`;
  - `common`.
- [x] Enforce module boundaries so transport modules call application services and domain code does not import infrastructure libraries.
- [x] Configure linting, formatting, type checking, unit tests, integration tests, and coverage commands.
- [x] Add path aliases only where they do not hide module ownership.

#### Configuration and process lifecycle

- [x] Add Zod validation for all environment variables and fail startup on invalid configuration.
- [x] Add `.env.example` without secrets.
- [x] Add a process lifecycle service for startup, readiness state, `SIGTERM`, drain, and shutdown.
- [x] Add `/healthz` as process liveness only.
- [x] Add `/readyz` with PostgreSQL and Redis dependency status and a drain-state override.
- [x] Establish consistent UTC storage and server-time handling.

#### Local infrastructure and build

- [x] Add Docker Compose services for the app, PostgreSQL 16+, and Redis 7+.
- [x] Add a multi-stage production Dockerfile with a non-root runtime user and minimal runtime contents.
- [x] Add Prisma generation/migration commands, but do not run production migrations automatically on app boot.
- [x] Add test-specific infrastructure configuration.

#### Baseline observability and CI

- [x] Configure Pino JSON logging and secret redaction.
- [x] Generate/propagate correlation IDs for HTTP requests.
- [x] Initialize OpenTelemetry in a way that can be disabled locally.
- [x] Add CI jobs for install, lint, type check, unit tests, integration tests, build, migration validation, dependency audit, and container build.

### Verification

- [x] `docker compose up` starts all dependencies and the app from a clean checkout.
- [x] Invalid environment configuration prevents startup with a safe error.
- [x] `/healthz` stays live during a Redis/PostgreSQL dependency failure.
- [x] `/readyz` becomes unavailable during dependency failure or graceful drain.
- [x] The production image runs as non-root and starts from built artifacts.
- [x] CI passes on an empty feature skeleton.

### Exit criteria

- A clean developer machine can boot, test, and build the service using documented commands.
- Health semantics and graceful process hooks exist before feature code.
- Strict typing and module boundaries are enforced automatically.

> **Result:** Passed locally under the pinned Node.js 24 toolchain. The
> Docker-only clean boot, migration, dependency-failure, graceful-drain,
> integration-test, and non-root production-image checks all passed.

---

## Phase 2 — Durable persistence foundation

### Objective

Make PostgreSQL capable of rejecting invalid durable state even when two app instances race or Redis is absent.

### Work

#### Prisma models and migrations

- [x] Create models and migrations for:
  - `guest_sessions`;
  - `games`;
  - `game_players`;
  - `moves`;
  - the Phase 0 durable active-game mechanism;
  - any approved idempotency records that must survive Redis loss.
- [x] Add the approved `match_id` or equivalent crash-safe game-allocation key.
- [x] Add durable clock timing fields from Gate C.
- [x] Add foreign keys and deletion behavior.
- [x] Add database checks for valid color, slot, version, ply, status/result, termination, and clock values.
- [x] Add uniqueness for:
  - case-insensitive display name;
  - match allocation key;
  - `(game_id, color)`;
  - `(game_id, guest_id)`;
  - `(game_id, slot)`;
  - `(game_id, client_move_id)`;
  - `(game_id, ply_number)`;
  - one active assignment per guest.
- [x] Implement the approved exactly-two-player guarantee or document why the atomic creation transaction plus other database constraints is the selected enforcement.
- [x] Add indexes for active-game recovery, expiry cleanup, ordered moves, and active status scans.
- [x] Use raw SQL migrations for generated columns, partial/expression indexes, row-level checks, deferred constraints, or triggers Prisma cannot express.

#### Persistence layer

- [x] Implement `PrismaService` lifecycle and connection management.
- [x] Add repository interfaces owned by their domain modules.
- [x] Add transaction helpers for:
  - `SELECT ... FOR UPDATE`;
  - conditional version updates;
  - unique-conflict classification;
  - retryable database errors.
- [x] Map database errors to stable domain errors without leaking SQL details.
- [x] Set explicit transaction timeouts and keep move transactions short.
- [x] Establish separate runtime and migration role requirements.

#### Migration safety

- [x] Add clean-database migration tests.
- [x] Add upgrade migration tests from the last released schema once releases begin.
- [x] Add a migration status check to CI.
- [x] Document expand/contract rules for zero-downtime changes.
- [x] Add backup/restore expectations for production PostgreSQL.

### Verification

- [x] Testcontainers starts a real PostgreSQL instance for integration tests.
- [x] Database tests prove each constraint rejects invalid rows.
- [x] Concurrent attempts cannot create two active game assignments for one guest.
- [x] The same match allocation key cannot create two games.
- [x] Duplicate `client_move_id` and duplicate ply values are rejected.
- [x] Invalid terminal status/result combinations are rejected.
- [x] Migration down/rollback policy is documented; production rollback does not depend on destructive schema reversal.

### Exit criteria

- PostgreSQL enforces all durable invariants needed by later phases.
- Transaction and error-classification utilities are tested and ready for the move hot path.

> **Result:** Passed locally with the pinned PostgreSQL 16 and Redis 7
> containers. Clean and Phase 1 upgrade migrations, Prisma schema drift,
> least-privilege roles, all durable constraint families, concurrent
> allocation, transaction utilities, Docker-only integration tests, the
> non-root production image, and the zero-vulnerability audit all passed.

---

## Phase 3 — Anonymous identity and session lifecycle

### Objective

Implement a low-PII anonymous identity that survives refresh, authenticates REST and WS traffic, renews safely, and can be revoked immediately under the approved policy.

### Work

#### Identity

- [x] Add curated adjective/noun catalogs and the avatar catalog.
- [x] Implement normalized profanity checks, including approved leetspeak normalization.
- [x] Generate `Adjective + Noun + digits` names using cryptographic randomness.
- [x] Reserve candidate names with Redis `SET NX` as a fast path.
- [x] Treat the PostgreSQL case-insensitive unique constraint as final authority and retry bounded collisions.
- [x] Add the longer random-suffix fallback.
- [x] Store and return avatar keys; never proxy image bytes through the API.

#### Token service

- [x] Load Ed25519 keys securely and support `kid`.
- [x] Issue JWTs with the exact approved claims and 12-hour default TTL.
- [x] Verify signature, algorithm, `kid`, version, `iat`, `exp`, and claim shape.
- [x] Implement the approved `jti` rotation and revocation behavior.
- [x] Never log raw tokens, authorization headers, private keys, or complete `jti` values.

#### REST endpoints

- [x] `POST /v1/session`
  - create the guest and token;
  - require UUID `Idempotency-Key`;
  - persist/replay the same result through `session_commands`;
  - set the approved secure cookie if cookie delivery is enabled.
- [x] `POST /v1/session/renew`
  - authenticate the current session;
  - require UUID `Idempotency-Key`;
  - apply the approved rotation policy;
  - return an idempotent result for a retried renewal.
- [x] `GET /v1/session`
  - return only the approved public guest/session fields.
- [x] `POST /v1/session/reset`
  - require UUID `Idempotency-Key`;
  - revoke the session;
  - add session-wide revocation and optional per-token denylist state;
  - expose a port for disconnecting all guest sockets once realtime is present;
  - treat a repeated reset as idempotent.
- [x] Apply Zod request/response validation and endpoint-specific rate limits.

#### Cleanup

- [x] Implement expired-session cleanup without deleting guest rows still referenced by retained games.
- [x] Document data retention and verify that no persistent IP/device fingerprint is added.

### Verification

- [x] Unit tests cover name format, profanity normalization, catalog safety, avatar selection, collision retry, and fallback.
- [x] Integration tests cover concurrent name collision and database uniqueness.
- [x] JWT tests cover expiry, wrong algorithm, unknown `kid`, malformed claims, rotation, revocation, and key overlap.
- [x] REST tests cover all success, validation, authentication, rate-limit, Redis-failure, and PostgreSQL-failure paths.
- [x] Session creation and renewal meet the latency target under normal local load.

### Exit criteria

- FR-1 and FR-2 are complete.
- The token verifier is ready to be reused by Socket.IO middleware.
- Reset/revocation semantics are deterministic during dependency degradation.

> **Result:** Passed locally with strict type/lint/build gates, 34 unit tests,
> the complete Dockerized integration suite, 86%+ unit line coverage, durable
> replay under concurrent and Redis-cold retries, fail-closed Redis and
> PostgreSQL outage checks, retention safety, revocation rebuilding, and local
> p95 create/renew latency at or below 150 ms.

---

## Phase 4 — Realtime protocol, authentication, and presence

> **Status:** Complete — accepted 2026-07-27

### Objective

Provide one authenticated Socket.IO namespace with strict message validation, stable acknowledgements, personal rooms, presence, and delivery infrastructure.

### Work

#### Protocol

- [x] Implement the v1 envelope and discriminated Zod schemas for every C→S and S→C event.
- [x] Centralize event names, error codes, payload limits, ack types, and protocol version handling.
- [x] Reject a mismatch between the Socket.IO event name and envelope `type` if Gate H requires it.
- [x] Generate server event IDs and server timestamps.
- [x] Propagate/generate `correlationId` for every inbound socket command and acknowledgement.
- [x] Map internal/domain errors to safe protocol errors.

#### Gateway and authentication

- [x] Create the single default namespace gateway.
- [x] Verify JWTs and the approved revocation state during handshake.
- [x] Store immutable authenticated identity in `socket.data`.
- [x] Join every socket to `guest:{guestId}`.
- [x] Emit `session.ready` with recovery hints.
- [x] Support multiple sockets/tabs for one guest without weakening one-queue/one-game rules.
- [x] Apply origin allowlisting, WSS production assumptions, connection caps, and `maxHttpBufferSize`.

#### Redis and delivery

- [x] Implement `ioredis` clients separated where required for commands, subscribers/adapter, and blocking work.
- [x] Register the Redis Streams Socket.IO adapter from the beginning.
- [x] Configure bounded connection-state recovery.
- [x] Implement `BroadcastService` so domain/application code emits through a transport-neutral port.
- [x] Ensure same-instance delivery remains usable when the adapter is degraded.

#### Presence

- [x] Mark presence during authenticated connection.
- [x] Implement `heartbeat.ping`/`heartbeat.pong`.
- [x] Refresh guest presence and relevant queue guard TTLs.
- [x] Track multiple sockets so one tab closing does not mark the guest absent while another remains connected.
- [x] Remove/expire presence only when no live socket remains.
- [x] Add socket command rate-limit hooks.

### Verification

- [x] Valid JWT connects; expired, forged, revoked, and malformed JWTs fail.
- [x] Invalid envelopes, payloads, protocol versions, origins, and oversized messages are rejected without reaching services.
- [x] Two tabs join the same personal room and share identity safely.
- [x] Presence survives one of multiple sockets disconnecting and expires after the final socket disappears.
- [x] Acks preserve event/correlation identifiers.
- [x] Tokens and private payloads are absent from logs.

### Exit criteria

- FR-3 is complete.
- The realtime layer is a thin validated/authenticated adapter ready for matchmaking and game commands.

> **Result:** Passed locally with strict format, lint, type, build, and unit
> coverage gates plus the complete Docker-backed integration suite. Evidence
> covers all v1 schemas, valid/invalid/revoked/expired authentication, exact
> origins, the 8 KiB transport limit, distributed connection caps, correlated
> acknowledgements, durable active-game hints, multi-tab presence, cross-node
> Redis Streams delivery, final disconnect cleanup, and same-instance delivery
> during adapter degradation. Matchmaking and game command handlers remain
> intentionally unavailable until their owning phases.

---

## Phase 5 — Chess and game-domain core

### Objective

Build deterministic, vendor-isolated chess rules and a pure game lifecycle before attaching them to concurrent persistence.

### Work

#### Domain model

- [x] Define game/player/move/snapshot domain types independent of Prisma and Socket.IO.
- [x] Implement the game state machine as explicit transition guards.
- [x] Make illegal transitions return stable domain errors.
- [x] Define terminal result derivation in one place.
- [x] Define version changes for moves and non-move terminal transitions.

#### Chess engine adapter

- [x] Define the approved history-aware `ChessEngine` interface.
- [x] Implement the `chess.js` adapter without exposing `chess.js` types outside the module.
- [x] Support:
  - normal legal and illegal moves;
  - promotion to queen/rook/bishop/knight;
  - castling;
  - en passant;
  - check and checkmate;
  - stalemate;
  - insufficient material;
  - threefold repetition using history;
  - fifty-move rule;
  - FEN load/round-trip;
  - SAN, UCI, and PGN generation.
- [x] Normalize engine exceptions into `IllegalMoveError` or configuration/data-corruption errors.
- [x] Keep the adapter deterministic for a given initial position, history, and proposal.

#### Clock domain

- [x] Implement pure clock calculations using server timestamps according to Gate C.
- [x] Cover increment, elapsed-time deduction, pause/resume, flag fall, and zero-boundary behavior.
- [x] Keep scheduling separate from clock calculation.

### Verification

- [x] Unit tests cover every state transition and forbidden transition.
- [x] Adapter tests cover every chess rule listed above with known positions.
- [x] Threefold tests prove history is considered rather than current FEN alone.
- [x] FEN/PGN/move replay results are consistent.
- [x] Clock tests use a fake time source and contain no sleeps.

### Exit criteria

- FR-7's rules layer is complete and strongly tested.
- The game service can depend on interfaces without importing `chess.js`.

> **Result:** Passed the strict format, lint, type, build, and unit coverage
> gates plus the complete Docker-backed integration suite. The pure domain
> covers every legal and forbidden lifecycle transition, canonical terminal
> derivation, monotonic versions, and server-timestamp clock arithmetic. The
> vendor-isolated `chess.js` adapter is verified for all required rules,
> history-aware threefold repetition, deterministic FEN/PGN replay, and
> fail-closed corruption handling.

---

## Phase 6 — Atomic matchmaking and durable game allocation

### Objective

Match exactly two distinct, present, eligible guests once and create exactly one durable game for the reservation.

### Work

#### Redis script layer

- [ ] Implement and version-control Lua scripts for:
  - enqueue;
  - leave;
  - try-match;
  - finalize;
  - rollback/release;
  - any compare-and-delete lease operation approved in Phase 0.
- [ ] Pass explicit keys/arguments and validate every script response.
- [ ] Load scripts by SHA with safe `NOSCRIPT` reload behavior.
- [ ] Preserve original enqueue score on idempotent duplicate joins and rollbacks.
- [ ] Make `try-match` discard/skip stale or absent candidates before reserving a pair.
- [ ] Validate reservation ownership/members during finalize and rollback.
- [ ] Apply the documented TTLs to guards, user states, reservations, and presence.
- [ ] Keep the single-node Redis MVP key scheme compatible with the documented `{mm}` Cluster migration.

#### Matchmaking service

- [ ] Implement idempotent `queue.join` and `queue.leave`.
- [ ] Reject guests with a durable active assignment even if Redis state is missing.
- [ ] Require present/connected guests for enqueue and re-enqueue.
- [ ] Trigger `tryMatch` after successful enqueue.
- [ ] Add the low-frequency backlog drainer without allowing concurrent double assignment.
- [ ] Implement FIFO fairness with atomic `ZPOPMIN`; defer optional oldest-plus-next-K randomization until strict FIFO is proven.
- [ ] Remove stale/disconnected/max-wait queue entries.
- [ ] Notify personal guest rooms of queue state changes.

#### Durable game allocation

- [ ] Generate server-side match/game IDs and random colors.
- [ ] In one PostgreSQL transaction:
  - make allocation idempotent by match key;
  - claim both guests as active;
  - create one game;
  - insert exactly two distinct players with opposite colors and slots;
  - set the initial position, version, status, and clocks.
- [ ] Finalize the Redis reservation only after PostgreSQL commits.
- [ ] On finalize failure, retain enough durable information for reconciliation instead of deleting the committed game.
- [ ] On database failure before commit, roll back/release the reservation and re-enqueue only guests still present.
- [ ] Emit `match.found` to each guest with their own color/opponent view and join deadline.

#### Initial room readiness

- [ ] Implement `game.ready` membership authorization.
- [ ] Join the authorized socket to `game:{gameId}`.
- [ ] Record player join/readiness under the approved persistence policy.
- [ ] Transition to `READY` only when both distinct players satisfy the readiness rule.
- [ ] Make repeated readiness idempotent.

### Verification

- [ ] Real-Redis tests cover script atomicity, errors, TTLs, and rollback.
- [ ] Parallel match attempts from two service instances never reuse a guest.
- [ ] A guest cannot join two queues or two active games even when Redis keys are deleted between requests.
- [ ] A guest cannot be matched with self.
- [ ] Duplicate `queue.join`, `queue.leave`, `game.ready`, finalize, and rollback are safe.
- [ ] Crash simulation after database commit/before Redis finalize recovers the same game.
- [ ] Room-creation failure re-enqueues only eligible connected guests with fair scores.
- [ ] Exactly two opposite-color player rows exist for every created game.

### Exit criteria

- FR-4, FR-5, FR-6, and the matchmaking portion of FR-12 are complete.
- Match allocation is safe across instances and process crashes.

---

## Phase 7 — Authoritative gameplay transaction

### Objective

Accept only legal on-turn moves from game members, persist each once, update the authoritative game, and broadcast only committed outcomes.

### Work

#### Snapshot read model

- [ ] Implement an authoritative snapshot query joining game, both players, and ordered moves.
- [ ] Return a guest-specific view (`you` versus `opponent`) after membership authorization.
- [ ] Include FEN, turn, version, clocks, status, result, termination, and full ordered move data.
- [ ] Treat Redis snapshot storage as a disposable cache only.

#### `move.submit`

- [ ] Validate the envelope, game ID, move coordinates, promotion, `clientMoveId`, and `expectedVersion`.
- [ ] Resolve the actor only from authenticated socket context.
- [ ] Execute the exact transaction:
  1. begin;
  2. lock the game row;
  3. check for the existing `(game_id, client_move_id)`;
  4. return the original result if already accepted;
  5. verify membership and color;
  6. verify status and turn;
  7. verify expected version;
  8. reconstruct/load authoritative history;
  9. calculate authoritative clock state;
  10. validate and apply the move;
  11. insert the move row;
  12. update FEN, PGN, turn, clocks, version, and any terminal result with a version guard;
  13. commit.
- [ ] Classify a raced unique violation as an idempotent retry and fetch the winning move.
- [ ] Map stale, unauthorized, off-turn, illegal, expired-clock, and dependency errors to stable rejections.
- [ ] Update/invalidate caches only after commit.
- [ ] Ack the submitter with the authoritative accepted/rejected result.
- [ ] Broadcast `move.accepted` after commit.
- [ ] If the move ends the game, broadcast `game.ended` after the accepted move in deterministic order.
- [ ] Include `gameVersion`, `clientMoveId`, `ply`, SAN, UCI, FEN, next turn, and clocks.

#### Game start and automatic completion

- [ ] Start the game/clocks under the approved READY rule.
- [ ] Persist `started_at` exactly once.
- [ ] Broadcast `game.started` after its state transition commits.
- [ ] Record checkmate and automatic draw outcomes in the move transaction.
- [ ] Delete durable active-game assignments in the same transaction as a terminal result; clear Redis lookup/state keys after commit.
- [ ] Make post-terminal repeats return the original terminal state instead of mutating it.

### Verification

- [ ] A complete two-client game can run from first move to checkmate.
- [ ] Every accepted event corresponds to a committed move row and incremented game version.
- [ ] Duplicate `clientMoveId` produces one row and the same ack.
- [ ] Same-version simultaneous moves result in exactly one valid acceptance.
- [ ] Off-turn, stale-version, illegal, non-member, and post-terminal moves are rejected.
- [ ] A forced crash before commit creates no move; retry succeeds normally.
- [ ] A forced crash after commit/before broadcast returns the committed move on retry/sync.
- [ ] Database audits prove no duplicate client move IDs, duplicate plies, ply gaps, or version drift.

### Exit criteria

- FR-8 and FR-9 are complete.
- Move-based portions of FR-10 are complete.
- The commit-before-broadcast and idempotent-retry invariants are proven.

---

## Phase 8 — Clocks and non-move terminal paths

### Objective

Complete every way a game can start, pause, resume, or end without relying on a move event.

### Work

#### Resignation

- [ ] Implement `game.resign` with a required idempotency/command ID.
- [ ] Authorize membership and lock the game.
- [ ] Apply a version/status guard and record winner, result, termination, ended time, and clock snapshot.
- [ ] Return the original terminal result on retry.

#### Timeout

- [ ] Schedule the next expected flag fall as an optimization.
- [ ] On timer fire, open a transaction and recompute flag fall from durable timestamps/clocks.
- [ ] Let status/version guards settle races with moves, resignation, or another timer.
- [ ] Recreate timers on boot/reconciliation and game sync.
- [ ] Do not depend on Redis key expiry notifications for correctness.

#### Join deadline and no-show

- [ ] Schedule/scan the initial join deadline.
- [ ] Apply the approved result for one or both missing players.
- [ ] Persist `EXPIRED` and terminal fields idempotently.
- [ ] Delete durable active assignments in the same terminal transaction and release Redis state only after commit.

#### Disconnect/reconnect grace

- [ ] Detect guest absence only after all that guest's sockets are gone.
- [ ] Persist or derive the approved `RECONNECTING` behavior.
- [ ] Create a Redis grace deadline plus an in-process timer/periodic scan.
- [ ] Emit `player.disconnected` after the state change and `player.reconnected` after successful recovery.
- [ ] Pause or continue clocks according to Gate C.
- [ ] Cancel/ignore stale grace work when the guest reconnects.
- [ ] After grace, transact abandonment only if the player is still absent and the game is eligible.
- [ ] Resolve double-disconnect and clock-expiry races according to Gate F.

#### Terminal cleanup

- [ ] Ensure every non-move terminal transaction deletes durable active-game assignments atomically with the terminal game update.
- [ ] In a post-commit idempotent cleanup step:
  - clear active-game cache keys;
  - reset user state;
  - invalidate snapshot cache;
  - emit `game.ended`;
  - remove sockets from the game room after ack or a bounded delay.
- [ ] Ensure cleanup can be retried by the reconciler.

### Verification

- [ ] Resignation, timeout, no-show, single abandonment, double abandonment, and reset-during-game have integration tests.
- [ ] Simultaneous terminal attempts produce one database result.
- [ ] Restarting the process does not prevent a clock timeout or grace expiry from eventually resolving.
- [ ] Multiple tabs obey presence semantics.
- [ ] Terminal cleanup is repeatable and leaves no durable active assignment.

### Exit criteria

- FR-10 is complete for all MVP termination reasons.
- The backend can reach a correct terminal state despite timer duplication or process loss.

---

## Phase 9 — Recovery, reconciliation, and dependency failure

### Objective

Make authoritative recovery the normal answer to refreshes, reconnects, missed events, drift, and service restarts.

### Work

#### Recovery APIs and events

- [ ] Implement `GET /v1/games/active` using PostgreSQL truth, with Redis as an optional cache.
- [ ] Implement `GET /v1/games/:id/snapshot` with membership authorization.
- [ ] Implement WS `game.sync`, accepting an optional known game/version under the approved contract.
- [ ] Rejoin the authorized socket to `game:{gameId}`.
- [ ] Return the full snapshot when connection-state recovery is unavailable or the client's version is not current.
- [ ] Refresh presence, active-game cache, snapshot cache, and grace state after authoritative reads.

#### Reconciliation

- [ ] Implement idempotent startup and periodic reconciliation for:
  - stale queue members;
  - guests stuck in `RESERVED`;
  - database games committed before Redis finalization;
  - terminal games with stale active-game/active-assignment data;
  - live games missing Redis active-game or snapshot keys;
  - expired join deadlines;
  - overdue clock deadlines;
  - overdue disconnect grace;
  - expired sessions eligible for cleanup.
- [ ] Bound scan sizes and use indexed database queries/cursors.
- [ ] Add metrics and structured logs for every repair and failure.
- [ ] Ensure two reconcilers can inspect the same item without double-mutating it.

#### Dependency degradation

- [ ] Redis unavailable:
  - fail matchmaking commands with retryable `SERVICE_UNAVAILABLE`;
  - bypass snapshot cache;
  - keep durable game commands operating when their correctness does not require Redis;
  - report readiness according to the approved production policy;
  - restore ephemeral state on recovery.
- [ ] PostgreSQL unavailable:
  - reject all durable mutations;
  - never ack a move or terminal result as accepted;
  - preserve process liveness but fail readiness;
  - give clients retry guidance.
- [ ] Adapter/fan-out unavailable:
  - keep local delivery;
  - rely on ack/version gaps/sync for convergence;
  - expose degradation metrics.

#### Client reliability support

- [ ] Ensure all command acks can be retried with the same identifier.
- [ ] Ensure server events contain monotonic version information where applicable.
- [ ] Return enough information for clients to detect a version gap and request sync.

### Verification

- [ ] Refresh restores the same active game and snapshot.
- [ ] Reconnect to another instance restores membership, presence, clock, and board.
- [ ] Reconnect inside grace resumes; outside grace returns the terminal snapshot.
- [ ] Deleting all documented Redis application keys does not lose a committed game or move.
- [ ] Killing Redis pauses matchmaking but preserves durable game correctness.
- [ ] Killing PostgreSQL causes closed move rejection and zero fabricated accepted events.
- [ ] Crash-window tests cover before commit, after commit/before emit, and after game creation/before Redis finalize.
- [ ] Reconciliation repairs every documented drift scenario.

### Exit criteria

- FR-11 and FR-13 are complete.
- Redis can be treated as disposable for recovery correctness.
- All §23 failure scenarios in `Architecture.md` have executable tests or a documented operational test.

---

## Phase 10 — Multi-instance operation and graceful delivery

### Objective

Prove that matchmaking, gameplay, presence, timers, broadcasts, reconciliation, and deployments behave the same across N identical replicas.

### Work

- [ ] Add a local/test topology with at least two app instances, one shared PostgreSQL, one shared Redis, and an Nginx/LB layer.
- [ ] Configure WSS upgrade headers, origin checks, payload limits, and sticky sessions.
- [ ] Force WebSocket transport where the client contract allows it; keep documented fallback behavior.
- [ ] Verify Redis Streams adapter cross-instance room delivery and bounded stream retention.
- [ ] Verify personal-room delivery when a guest has tabs on different instances.
- [ ] Verify game-room delivery when opponents are on different instances.
- [ ] Make presence account for sockets across the fleet, not just the local process.
- [ ] Verify background-job ownership/leases under instance churn.
- [ ] Implement graceful drain:
  - set readiness false;
  - reject new connections and queue joins;
  - finish bounded in-flight transactions;
  - emit reconnect advisory;
  - disconnect remaining sockets after the drain window;
  - close adapter, Redis, and PostgreSQL clients cleanly.
- [ ] Add metrics for connections and in-flight work by instance.
- [ ] Document datastore scale path: PostgreSQL primary/read replica boundaries and Redis primary/replica before Cluster.

### Verification

- [ ] Two instances racing `tryMatch` never double-assign.
- [ ] Two instances racing moves/terminal timers converge through PostgreSQL.
- [ ] Opponents on different instances receive the same accepted move.
- [ ] A rolling restart causes only a reconnect/snapshot, not game loss.
- [ ] Killing the instance that scheduled a timeout/grace does not prevent terminal resolution.
- [ ] Removing one app replica does not leave queue entries or presence permanently stuck.
- [ ] Observable protocol behavior is identical in one- and two-instance suites.

### Exit criteria

- Horizontal scaling requires configuration/capacity changes, not domain-code redesign.
- FR-12's cross-instance invariants are proven.

---

## Phase 11 — Security, observability, and operational hardening

### Objective

Complete the security controls and make the service diagnosable, measurable, and safe to operate.

### Work

#### Security

- [ ] Audit WSS enforcement and origin allowlisting at both edge and app layers.
- [ ] Enforce per-IP connection/session-create limits and per-guest queue/move/renew/sync limits.
- [ ] Use atomic Redis rate-limit operations and document fail-open/fail-closed behavior by command.
- [ ] Enforce membership on every game read and command.
- [ ] Enforce payload-size and per-socket send-queue/backpressure limits.
- [ ] Verify event replay and duplicate-command protection.
- [ ] Redact JWTs, keys, credentials, cookies, authorization headers, and sensitive Redis/DB URLs.
- [ ] Use private/TLS-authenticated PostgreSQL and Redis connections in production.
- [ ] Use a least-privilege runtime DB role and separate migration role.
- [ ] Source secrets from the deployment secret manager.
- [ ] Add dependency, license, secret, and container scanning to CI.
- [ ] Run the production container non-root with read-only filesystem where compatible.
- [ ] Restrict `/metrics` at the network/edge layer.

#### Metrics

- [ ] Expose Prometheus-format metrics on the restricted `/metrics` endpoint.
- [ ] Implement the metrics named in `Architecture.md`, including:
  - WS connections;
  - queue depth and wait time;
  - active rooms/games;
  - accepted/rejected/duplicate moves;
  - move and broadcast latency;
  - PostgreSQL transaction failures and optimistic conflicts;
  - Redis latency/errors;
  - reconnect success;
  - abandonment;
  - cleanup/reconciliation failure;
  - event-loop lag;
  - process memory/restarts.
- [ ] Keep metric labels bounded; never use raw guest/game/event IDs as labels.

#### Logs and traces

- [ ] Add structured context for correlation, guest (safely represented), game, event, latency, and outcome.
- [ ] Add trace spans for session creation, matchmaking, game allocation, move transaction, snapshot recovery, and broadcast.
- [ ] Instrument PostgreSQL and Redis without leaking query secrets or creating excessive hot-path overhead.
- [ ] Sample traces according to environment and error status.

#### Dashboards, alerts, and runbooks

- [ ] Create dashboards for the RED/USE and chess-domain metrics.
- [ ] Configure alerts for event-loop lag, move latency, queue stalls, database failures, Redis failures, reconnect failures, cleanup failures, and instance flapping.
- [ ] Add runbooks linked from every alert.
- [ ] Document capacity signals and scaling thresholds from `Architecture.md`.

### Verification

- [ ] Security tests cover forged/expired/revoked tokens, wrong origin, oversized payload, non-member access, replay, rate limits, and log redaction.
- [ ] Metrics appear with stable bounded labels during an end-to-end game.
- [ ] One action can be followed by correlation ID from boundary through Redis/DB and broadcast.
- [ ] Alert rules can be exercised in a non-production environment.
- [ ] `/metrics` is unreachable from the public route.

### Exit criteria

- FR-14 and the security/observability NFRs are complete.
- Operators can identify dependency, latency, queue, game, and connection failures from dashboards and logs.

---

## Phase 12 — End-to-end, failure, and load qualification

### Objective

Produce repeatable evidence that the backend meets correctness, recovery, security, and performance requirements at and beyond the MVP target.

### Work

#### Automated test pyramid

- [ ] Complete unit suites for pure domain logic, schemas, identity, clocks, state transitions, and engine rules.
- [ ] Complete real-PostgreSQL/Redis integration suites for constraints, transactions, Lua, TTLs, and reconciliation.
- [ ] Complete single-instance WS end-to-end flows.
- [ ] Complete multi-instance WS end-to-end flows behind the LB.
- [ ] Complete dependency-kill and process-crash suites.
- [ ] Remove flaky timing sleeps; use fake clocks, polling assertions, or bounded eventually conditions.

#### Artillery load profile

- [ ] Implement session bootstrap and authenticated Socket.IO connection.
- [ ] Ramp to 2,000 concurrent users/connections over five minutes and hold for ten minutes.
- [ ] Sustain approximately 1,000 active rooms/games.
- [ ] Run a separate 2,500-physical-socket stress step to exercise the documented multi-tab/headroom assumption.
- [ ] Add queue churn: a subset leaves after randomized short waits.
- [ ] Play scripted legal openings with unique `clientMoveId` and tracked versions.
- [ ] Drive some games to a known checkmate.
- [ ] Hard-disconnect approximately 15% of virtual users and reconnect within grace.
- [ ] Run through at least two app replicas and the production-like LB configuration.
- [ ] Collect application, Redis, PostgreSQL, host, and LB metrics during the run.

#### Correctness audits

- [ ] Automate SQL assertions for:
  - no duplicate `(game_id, client_move_id)`;
  - no duplicate/gapped ply sequence;
  - game version equals the accepted move count under the approved non-move-version rule;
  - exactly two distinct players and colors for each game;
  - no guest in multiple active assignments;
  - every terminal game has a valid result and termination;
  - no non-terminal game has a terminal result.
- [ ] Audit stuck Redis reservations, queue guards, grace keys, and user states after the run.

#### Performance and resilience targets

- [ ] Guest session create p95 ≤ 150 ms.
- [ ] WS connect after TLS p95 ≤ 300 ms.
- [ ] Match with opponent waiting p95 ≤ 500 ms.
- [ ] Move validate + persist p95 ≤ 50 ms.
- [ ] Commit-to-broadcast p95 ≤ 50 ms.
- [ ] Reconnect + snapshot p95 ≤ 800 ms.
- [ ] Demonstrate the hot path at a burst target of 500 committed moves/second or record the first measured bottleneck and capacity limit.
- [ ] Zero duplicate accepted moves.
- [ ] Zero double game assignments.
- [ ] No unbounded event-loop lag, memory growth, Redis stream growth, or database pool starvation.
- [ ] Tune connection pools, event loop, payloads, Redis scripts, and queries only from measured bottlenecks.

#### Soak and release evidence

- [ ] Run a longer lower-volume soak to detect leaks and stale state.
- [ ] Save test versions, environment configuration, dashboards, reports, and audit outputs as release artifacts.
- [ ] Record any accepted exceptions with an owner and follow-up criterion; correctness exceptions block release.

### Exit criteria

- Every acceptance target has a repeatable test and retained evidence.
- Performance targets are met across at least two instances.
- Post-run database and Redis audits are clean.
- No unresolved critical/high security or correctness defect remains.

---

## Phase 13 — Production release and operations

### Objective

Deploy the MVP safely with controlled migrations, recovery procedures, monitoring, and an explicit rollback path.

### Work

#### Infrastructure

- [ ] Provision managed PostgreSQL with automated backups and point-in-time recovery (PITR).
- [ ] Provision private, authenticated, TLS-enabled managed Redis.
- [ ] Provision the app service, TLS/WSS load balancer, sticky routing, origin allowlist, and internal metrics route.
- [ ] Store JWT keys and datastore credentials in a secret manager.
- [ ] Configure log, trace, metric, dashboard, and alert destinations.
- [ ] Set resource requests/limits using Phase 12 measurements.

#### Deployment pipeline

- [ ] Run migrations as a gated one-off deployment step using the migration role.
- [ ] Use backward-compatible expand/contract migrations.
- [ ] Deploy the immutable image by digest.
- [ ] Run readiness, REST, authenticated WS, queue/match, move, reconnect, and metrics smoke tests.
- [ ] Exercise graceful drain during a staging rolling deployment.
- [ ] Define rollback to the previous application image without requiring destructive database rollback.

#### Runbooks

- [ ] Document:
  - Redis outage;
  - PostgreSQL outage/failover;
  - elevated move latency;
  - matchmaking stall;
  - connection/reconnect spike;
  - stuck reconciliation;
  - JWT key rotation;
  - emergency session invalidation;
  - migration failure;
  - restore from backup;
  - scaling app replicas;
  - graceful/manual drain.
- [ ] Document data retention and cleanup operations.
- [ ] Document the criteria for moving Redis to primary/replica and PostgreSQL to a larger primary/read replica.

#### Launch gate

- [ ] Verify production configuration against `.env.example`/config schema.
- [ ] Verify no development keys, origins, credentials, or debug endpoints are present.
- [ ] Verify backups and a restore test.
- [ ] Verify all alerts have an owner and reachable notification path.
- [ ] Verify release artifacts and load-test evidence.
- [ ] Run a limited rollout/canary before opening full traffic.
- [ ] Monitor SLOs, error rates, queue wait, abandonment, resource use, and reconciliation during launch.

### Exit criteria

- The production backend is deployed, monitored, recoverable, and documented.
- A failed release can be rolled back without losing committed games or moves.
- The launch checklist is signed off with no correctness exception.

---

## 6. Requirement traceability

| Requirement | Implemented in | Proved in |
|---|---|---|
| FR-1 Create anonymous guest session | Phase 3 | Phase 3 integration, Phase 12 E2E/load |
| FR-2 Renew/get/reset session | Phase 3 | Phase 3 REST/security tests |
| FR-3 Authenticate Socket.IO handshake | Phase 4 | Phase 4 and Phase 11 security tests |
| FR-4 Join/leave FIFO queue | Phase 6 | Lua/integration/multi-instance tests |
| FR-5 Exactly two distinct users per match | Phases 2 and 6 | DB constraints and race tests |
| FR-6 Random server-side colors | Phases 5 and 6 | Domain/integration tests |
| FR-7 Validate all chess rules | Phase 5, consumed in Phase 7 | Engine adapter and gameplay tests |
| FR-8 Persist accepted moves idempotently | Phases 2 and 7 | Duplicate/concurrent/crash tests and audits |
| FR-9 Broadcast accepted move and game end | Phases 7 and 10 | Single/multi-instance E2E |
| FR-10 All terminal outcomes | Phases 7 and 8 | Lifecycle/race/restart tests |
| FR-11 Disconnect grace and reconnect | Phases 8 and 9 | Reconnect and timer-loss tests |
| FR-12 Queue/game/self/double-assignment invariants | Phases 0, 2, 6, 10 | DB, Lua, and multi-instance tests |
| FR-13 Active game and snapshot recovery | Phase 9 | Refresh/reconnect/failure tests |
| FR-14 Health/readiness/metrics | Phases 1 and 11 | Dependency and access-control tests |

| Non-functional area | Main phases | Release evidence |
|---|---|---|
| Correctness | 0, 2, 5–10 | Constraint, race, crash, reconciliation, and audit suites |
| Availability/degradation | 1, 8–10 | Dependency-kill and rolling-restart tests |
| Latency | 1, 7, 10–12 | Artillery histograms and datastore metrics |
| Scalability | 4, 6, 9, 10, 12 | Two-instance load profile |
| Idempotency | 0, 2, 3, 6–9 | Duplicate/retry tests for every mutation |
| Durability | 2, 7–9 | Crash-before/after-commit tests |
| Security | 1, 3, 4, 11 | Security suite and deployment audit |
| Observability | 1, 6–11 | Logs, metrics, traces, dashboards, alerts |
| Operability | 1, 9–13 | Compose, migrations, drain, runbooks, restore |

---

## 7. Test suite organization

```text
test/
├─ unit/
│  ├─ common/
│  ├─ identity/
│  ├─ chess/
│  ├─ game/
│  └─ clocks/
├─ integration/
│  ├─ postgres/
│  ├─ redis-lua/
│  ├─ session/
│  ├─ matchmaking/
│  ├─ gameplay/
│  ├─ recovery/
│  └─ reconciliation/
├─ e2e/
│  ├─ single-instance/
│  ├─ multi-instance/
│  ├─ dependency-failure/
│  └─ security/
└─ fixtures/
   ├─ chess-positions/
   └─ protocol/

load-tests/
├─ artillery.socketio.yml
├─ processors/
├─ audits/
└─ reports/
```

Test naming should describe the invariant, not the implementation. Examples:

- `does not allocate one guest to two games when matchers race`
- `returns the original accepted move when clientMoveId is retried`
- `restores a committed move after crash before broadcast`
- `does not abandon a guest while another tab remains connected`
- `detects threefold repetition from history`

---

## 8. Pull request and integration strategy

Keep changes reviewable without leaving correctness split across long-lived branches.

- One phase may use several small PRs, but a PR should be a complete vertical or infrastructure slice.
- Land contract/schema changes before services that depend on them.
- Add failing invariant tests with or immediately before the implementation.
- Keep migrations immutable after they have reached a shared environment; add a new migration for corrections.
- Feature flags may hide incomplete public flows, but must not select between two correctness models.
- Avoid a separate “refactor everything” phase; clean boundaries as each module is introduced.
- Do not optimize snapshot caching, queue randomization, read replicas, or partitioning until measurement shows need.
- Each PR must update relevant protocol/config/operational documentation.

Suggested integration slices:

1. foundation + health;
2. database schema + constraint tests;
3. identity + create/get session;
4. renew/reset + revocation;
5. gateway auth + envelope;
6. presence + heartbeats;
7. chess engine + state machine;
8. enqueue/leave Lua;
9. match allocation + ready;
10. snapshot + move transaction;
11. automatic game end;
12. resign/clock/grace;
13. recovery + reconciliation;
14. multi-instance + drain;
15. hardening + telemetry;
16. load qualification + deployment.

---

## 9. Definition of done for every phase

A phase is not complete until:

- [ ] implementation matches the approved Architecture/ADR contract;
- [ ] public inputs and outputs have Zod validation;
- [ ] authorization derives identity from the authenticated context;
- [ ] all new mutations have an explicit idempotency and concurrency story;
- [ ] database/Redis failure behavior is defined and tested where relevant;
- [ ] unit/integration/E2E tests appropriate to the risk are green;
- [ ] logs redact secrets and contain correlation/outcome context;
- [ ] required metrics and traces exist without unbounded labels;
- [ ] config is validated and documented;
- [ ] migrations work from a clean database;
- [ ] lint, type check, tests, and production build pass;
- [ ] the phase exit criteria have evidence;
- [ ] `Architecture.md`, ADRs, protocol docs, and runbooks are updated if behavior changed.

---

## 10. Deferred work outside the MVP

Do not add these to the critical path:

- accounts, email, OAuth, or persistent user profiles;
- ratings, Elo, leaderboards, or tournaments;
- selectable time controls or chess variants;
- swiping, browsing, friends, messaging, or direct challenges;
- rematch, private invite rooms, or spectating;
- draw-by-agreement or takebacks;
- Kafka, NATS, RabbitMQ, or a durable event outbox without an external durable side effect;
- independent microservices;
- Kubernetes;
- Redis Cluster before a single-node/primary-replica deployment is measured as insufficient;
- move-table partitioning before retention/volume justifies it;
- a dedicated realtime service before profiling shows the modular monolith is the bottleneck.

These remain extension points, not partially implemented features.

---

## 11. Final release acceptance checklist

- [ ] Anonymous create, renew, get, and reset are correct and rate-limited.
- [ ] Socket handshake authentication, origin enforcement, and payload validation are correct.
- [ ] Queue join/leave is FIFO, idempotent, and safe during concurrent match attempts.
- [ ] No guest can be queued twice, matched with self, or durably assigned to two active games.
- [ ] Each game has exactly two distinct players with opposite server-selected colors.
- [ ] Every chess rule and automatic terminal condition has engine tests.
- [ ] Every accepted move is committed once, increments version correctly, and broadcasts after commit.
- [ ] Duplicate, stale, illegal, off-turn, non-member, and concurrent moves resolve correctly.
- [ ] Resignation, timeout, no-show, reset, disconnect, reconnect, and abandonment races resolve once.
- [ ] Refresh, instance loss, missed broadcast, and Redis-key loss recover from PostgreSQL.
- [ ] Redis outage pauses/degrades coordination without corrupting games.
- [ ] PostgreSQL outage fails durable commands closed.
- [ ] Single- and multi-instance protocol behavior is equivalent.
- [ ] Graceful rolling deployment loses no committed state.
- [ ] Health, readiness, restricted metrics, structured logs, traces, dashboards, and alerts are operational.
- [ ] Security controls and dependency/container scans pass.
- [ ] The 2,000-connection / approximately 1,000-game multi-instance load test meets all latency targets.
- [ ] Post-load database and Redis correctness audits are clean.
- [ ] Backup restore, migration, rollback, key rotation, outage, and scaling runbooks are verified.

When every item above is satisfied, the backend described by `Architecture.md` is ready for MVP production traffic.
