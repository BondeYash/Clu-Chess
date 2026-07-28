# Frontend Contract Coverage

> **Status:** Validated against the implemented backend and
> [`../protocol-v1.md`](../protocol-v1.md) on 2026-07-28
> **Purpose:** Give every backend route/event an explicit frontend owner, screen,
> trigger, recovery behavior, and contract-test fixture.

## Contract rules frozen for the client

- Protocol version is `1`.
- Socket.IO event name equals envelope `type`.
- Every client command requires an acknowledgement callback.
- Client command objects are strict.
- Client receive schemas tolerate additive unknown server fields.
- Client timestamps are diagnostic only.
- Game version is not move/ply count.
- Full snapshot is recovery authority.
- Unknown/breaking protocol version shows an update-required state.
- Guest ID, color, turn, result, and membership are never supplied as authority
  by the UI.

## HTTP ownership

| Route                        | Owner                        | Screen/trigger                                                                          | Loading                                          | Failure/recovery                                                                        | Cache/mutation                                                  |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `POST /v1/session`           | Session coordinator          | Guest route after cookie/bearer recovery proves no session; explicit create after reset | Branded bootstrap                                | Same key retry on network/503; 429 wait; definitive 401 does not loop                   | Mutation; seed session view, then background GET for `issuedAt` |
| `POST /v1/session/renew`     | Renewal coordinator          | Five minutes before expiry; cookie-valid/token-missing tab                              | Usually background; bootstrap blocks socket only | Same key bounded retry; 401 identity-loss path; 429 wait                                | Mutation; update token/expiry                                   |
| `GET /v1/session`            | Session query                | Bootstrap, stale focus/reconnect, settings identity                                     | Identity skeleton                                | Bearer 401 → cookie-only retry once; then create only outside active identity-loss path | `session.current`, stale 5 min                                  |
| `POST /v1/session/reset`     | Settings/session coordinator | Confirmed destructive action                                                            | Dialog/button pending                            | Same key retry; preserve dialog and show correlation                                    | Mutation; success clears every guest owner                      |
| `GET /v1/games/active`       | Game recovery                | After session ready, reconnect, active conflict                                         | Resume-card skeleton                             | Keep known safe active ID; bounded retry                                                | `game.active`, stale 5 sec                                      |
| `GET /v1/games/:id/snapshot` | Game recovery/query          | Deep link, refresh, socket fallback, uncertain command                                  | Board-shaped skeleton                            | 400 invalid, 403/404 private unavailable, 503 retained safe board/retry                 | `game.snapshot(id)`; live state event-updated                   |
| `GET /healthz`               | Platform                     | Container/load-balancer probe only                                                      | None in browser                                  | Infrastructure alert                                                                    | No frontend request                                             |
| `GET /readyz`                | Platform                     | Routing readiness only                                                                  | None in browser                                  | Generic UI derives failure from actual API/socket, not DB/Redis detail                  | No frontend request                                             |
| `GET /metrics`               | Prometheus/internal platform | Never public                                                                            | None                                             | Public edge must block                                                                  | No frontend request                                             |

### HTTP fixture IDs

Phase 1 contract package must include:

- `session.create.201.json`
- `session.create.replay.200.json`
- `session.renew.200.json`
- `session.current.200.json`
- `session.reset.200.json`
- `games.active.none.200.json`
- `games.active.present.200.json`
- `games.snapshot.waiting.200.json`
- `games.snapshot.live.200.json`
- `games.snapshot.reconnecting.200.json`
- `games.snapshot.terminal.200.json`
- one common error fixture for every public error code/status combination;
- malformed, unknown-additive-field, and wrong-version fixtures.

## Client-to-server Socket.IO ownership

| Command          | Feature owner        | Screen/trigger                             | Identifier policy                                        | Success handling                                         | Error/recovery                              |
| ---------------- | -------------------- | ------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| `queue.join`     | Matchmaking          | `/play`, Find match                        | New `eventId`; reuse on exact retry                      | `queue.joined` sets authoritative queue state            | `ALREADY_IN_GAME` recovers; 429/503 inline  |
| `queue.leave`    | Matchmaking          | `/play`, Cancel search                     | New `eventId`; reuse on exact retry                      | `queue.left` clears queue/intent                         | Restore queued display on failure           |
| `game.ready`     | Game session         | `/game/:id` after match/recovery room join | New `eventId`; expected current version; reuse on retry  | Complete snapshot replaces game                          | Stale → sync; unavailable → route recovery  |
| `move.submit`    | Game move controller | Board legal target/promotion               | New `eventId` + `clientMoveId`; both stable across retry | Apply ack through reducer                                | Rollback overlay; stale/uncertain → sync    |
| `game.resign`    | Game actions         | Confirmed resign dialog                    | New durable `eventId`; stable across retry               | Apply terminal ack                                       | Stale/ended → sync                          |
| `game.sync`      | Game recovery        | Gap/reconnect/focus/user retry             | New `eventId` for the sync attempt                       | Snapshot replaces; session ready may show no active game | One retry then HTTP snapshot                |
| `heartbeat.ping` | Realtime coordinator | Connected interval/resume                  | New `eventId` per ping                                   | Update offset/lease health                               | No immediate retry; next interval/reconnect |

### Command fixtures

For each command:

- minimum valid envelope;
- maximum optional supported fields;
- missing/wrong `eventId`;
- wrong protocol version;
- event name/type mismatch;
- unknown inbound field;
- missing acknowledgement integration case.

Additional move fixtures:

- normal move;
- promotion `q/r/b/n`;
- illegal square;
- missing `clientMoveId`;
- duplicate exact retry;
- reused ID with changed payload;
- stale version.

## Server-to-client event ownership

| Event                 | Owner                    | Screen effect                                         | Version rule                                      | Duplicate/recovery                                                     |
| --------------------- | ------------------------ | ----------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `session.ready`       | Session coordinator      | Resolve guest/active assignment                       | No game version                                   | Reconcile with REST active ID                                          |
| `queue.joined`        | Matchmaking store        | Joining → queued                                      | No game version                                   | Preserve original `since`; repeated success is current state           |
| `queue.left`          | Matchmaking store        | Queued/leaving → lobby/matched transition             | No game version                                   | Idempotently clear intent                                              |
| `match.found`         | Match/game coordinator   | Navigate to game; provisional opponent/color/deadline | Authoritative game version                        | Dedupe event; active recovery if navigation interrupted                |
| `game.snapshot`       | Game reducer             | Replace waiting/live/reconnecting/terminal game       | Authoritative version                             | Replace unless raced below already-applied higher version; then resync |
| `game.started`        | Game reducer             | Start clocks/game status                              | Incremental                                       | Normal next applies; gap syncs                                         |
| `move.accepted`       | Game reducer             | Confirm board/FEN/move/clocks/check                   | Incremental, contains ply/client move ID on event | Dedupe event and ply; ack/broadcast share semantic move                |
| `move.rejected`       | Pending move controller  | Clear/resolve submitting move                         | Targeted current/authoritative version            | Never broadcast to opponent UI; stale syncs                            |
| `player.disconnected` | Game reducer/presence UI | Grace notice; clocks continue                         | Incremental                                       | Dedupe; retain safe board                                              |
| `player.reconnected`  | Game reducer/presence UI | Clear notice; expect snapshot                         | Incremental                                       | Snapshot reconciles                                                    |
| `game.ended`          | Game reducer/result UI   | Final FEN/clocks/result/termination/PGN               | Incremental or equal-version companion            | Dedupe; terminal cache retained on route                               |
| `heartbeat.pong`      | Realtime coordinator     | Offset/transport health only                          | No game version                                   | Bounded sample window                                                  |
| `server.error`        | Error router             | Inline route/transport recovery                       | Optional version/game context                     | Respect retryability; do not show raw code                             |

### Event fixtures

- All 13 minimum valid envelopes.
- Every `GameStatus`, `Result`, `Termination`, and color.
- Snapshot move counts deliberately different from game version.
- Unknown optional server field accepted.
- Missing required known field rejected.
- Same move as ack then broadcast and broadcast then ack.
- Equal-version `move.accepted` + `game.ended`.
- Stale, exact-next, and gapped versions.
- Mismatched game ID.

## Acknowledgement ownership

| Ack type         | Caller                          | Handling                                                |
| ---------------- | ------------------------------- | ------------------------------------------------------- |
| `queue.joined`   | Matchmaking command             | Resolve joining, store queue                            |
| `queue.left`     | Matchmaking command             | Resolve leaving, clear queue                            |
| `game.snapshot`  | Ready/sync                      | Run complete snapshot path                              |
| `move.accepted`  | Move command                    | Run same reducer path as broadcast with pending context |
| `game.ended`     | Resign command                  | Run terminal reducer                                    |
| `heartbeat.pong` | Heartbeat                       | Update health/offset                                    |
| `session.ready`  | `game.sync` without active game | Clear active state and route lobby                      |
| `server.error`   | Any non-move failure            | Typed feature error mapping                             |
| `move.rejected`  | Move failure                    | Pending move rollback/sync mapping                      |

Ack timeout is not a rejection. The caller retains identifiers, retries within
policy, and synchronizes if still uncertain.

## Protocol error UX map

| Code                           | User-facing behavior                                                 | Automatic action                                                           |
| ------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `UNAUTHORIZED`                 | “Your anonymous session is no longer available.”                     | Bootstrap recovery only where safe; never silently replace active identity |
| `INVALID_PAYLOAD`              | “This action could not be sent. Refresh CluChess.”                   | Report contract signal; no retry                                           |
| `UNSUPPORTED_PROTOCOL_VERSION` | “CluChess has been updated. Refresh to continue.”                    | Stop commands; offer hard refresh                                          |
| `UNSUPPORTED_EVENT`            | “This version cannot perform that action.”                           | Report; no retry                                                           |
| `IDEMPOTENCY_KEY_REUSED`       | “This action could not be safely repeated.”                          | Sync when game-related; no new-key blind retry                             |
| `ALREADY_QUEUED`               | Keep/show current queue                                              | Treat as semantic current state                                            |
| `ALREADY_IN_GAME`              | “You already have a game in progress.”                               | Read active game and resume                                                |
| `GAME_NOT_FOUND`               | Private unavailable state                                            | Clear stale active hint after authoritative check                          |
| `GAME_ALREADY_ENDED`           | “This game has already ended.”                                       | Sync terminal snapshot                                                     |
| `NOT_A_PLAYER`                 | Private unavailable state                                            | Stop game commands                                                         |
| `NOT_YOUR_TURN`                | “Wait for your opponent's move.”                                     | Clear pending; preserve board                                              |
| `ILLEGAL_MOVE`                 | “That move is not legal in this position.”                           | Clear pending; retain selection only if helpful                            |
| `STALE_GAME_VERSION`           | “The board changed. Updating…”                                       | Sync; do not blind resubmit                                                |
| `CLOCK_EXPIRED`                | “The server is confirming the result.”                               | Sync terminal result                                                       |
| `RATE_LIMITED`                 | “Please wait {duration} before trying again.”                        | Honor `retryAfterMs`                                                       |
| `SERVICE_UNAVAILABLE`          | “CluChess is temporarily unavailable. Your confirmed state is safe.” | Bounded same-ID retry, then explicit retry                                 |
| `INTERNAL_ERROR`               | “Something went wrong while completing that action.”                 | Bounded same-ID retry when marked retryable; then sync/retry               |

## Event ordering cases

### Matchmaking

- `queue.left(matched)` may precede or follow `match.found`.
- `match.found` is sufficient to clear queue state and navigate.
- A duplicate `queue.left` cannot return the UI from a found/active game to
  idle.

### Ready/start

- First ready ack can return version 0 waiting snapshot.
- Starting may advance through versions 1 and 2 while only a version 2 start
  event is observed by the first player.
- A detected gap synchronizes rather than inventing the missing transition.

### Move/terminal

- Ack and broadcast can arrive in either order.
- A terminal move may emit `move.accepted` followed by `game.ended` at the same
  authoritative game version.
- Move list deduplication uses `ply`; event deduplication uses `eventId`.

### Disconnect/reconnect

- `player.reconnected` may be followed by a full snapshot.
- Snapshot replaces provisional presence state.
- Transport reconnect is distinct from opponent presence reconnect.

## State and cache ownership

| Contract data              | Owner                                                     |
| -------------------------- | --------------------------------------------------------- |
| Guest                      | `queryKeys.session.current()`                             |
| Active game ID             | `queryKeys.game.active()`                                 |
| Game snapshot              | `queryKeys.game.snapshot(gameId)`                         |
| Queue                      | Matchmaking Zustand slice + session queue intent          |
| Transport/last pong/offset | Realtime store                                            |
| Pending command            | Feature coordinator + bounded session storage identifiers |
| Server event IDs           | Bounded in-memory LRU                                     |

## Pagination, filtering, searching, and sorting

No v1 endpoint returns a collection requiring these behaviors. They are
explicitly not applicable:

- no game history table;
- no leaderboard;
- no player search;
- no time-control list;
- no admin list.

Move history is a complete ordered snapshot/event stream, not a paginated API.
It may be visually virtualized above 200 plies without changing server
semantics.

## Backend gaps retained outside v1

| Gap                                | V1 behavior                                               |
| ---------------------------------- | --------------------------------------------------------- |
| No authoritative queued-state read | Persist intent and repeat idempotent join                 |
| Snapshot omits PGN                 | PGN actions only when current tab receives terminal event |
| No history/list                    | No table/filter/search UI                                 |
| Fixed blitz only                   | One honest control; no selector                           |
| No rematch                         | Return to lobby                                           |
| Avatar key only                    | Checked asset map + fallback                              |
| No roles                           | Guest capabilities only                                   |
| `/readyz` docs/runtime mismatch    | Browser does not consume it                               |

## Coverage acceptance

- [x] All 9 HTTP routes have an owner and policy.
- [x] All 7 client commands have a screen, identifiers, and recovery.
- [x] All 13 server events have a reducer/coordinator owner.
- [x] All 17 protocol errors have user behavior.
- [x] Ack/broadcast and lifecycle ordering cases are explicit.
- [x] Required Phase 1 contract fixtures are enumerated.
- [x] Unsupported list/role/dashboard features are explicitly absent.
