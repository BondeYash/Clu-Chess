# CluChess Protocol v1

> **Status:** Accepted
> **Authority:** Normative transport contract for backend and clients
> **Related decision:** [ADR 0008](adr/0008-versioned-protocol-and-acknowledgements.md)

## 1. Transport and authentication

- REST base path: `/v1`
- Socket.IO namespace: `/`
- Production transport: WSS; WebSocket is preferred and polling fallback requires sticky sessions.
- REST auth: `Authorization: Bearer <guest JWT>` and/or the configured HttpOnly guest cookie.
- Socket auth: handshake `auth.token`.
- Authenticated guest identity always comes from the verified token and server context.
- Clients never send an authoritative guest ID, color, turn, result, or opponent identity.
- Content type for REST JSON: `application/json`.
- Maximum decoded Socket.IO message: 8 KiB.

## 2. Scalar formats

| Name                             | Format                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| UUID                             | Lower/upper-case RFC 4122 UUID accepted; normalized lowercase internally |
| `eventId`                        | Client UUIDv4 for C→S; server UUIDv4 for S→C                             |
| `clientMoveId`                   | Client UUIDv4, stable across move retry                                  |
| `correlationId`                  | UUIDv4 generated at boundary unless a valid one was supplied             |
| `gameId` / `matchId` / `guestId` | UUIDv4                                                                   |
| Board square                     | `/^[a-h][1-8]$/`                                                         |
| Promotion                        | `q`, `r`, `b`, or `n`                                                    |
| Epoch timestamp                  | Integer milliseconds since Unix epoch                                    |
| Game version                     | Non-negative safe integer                                                |
| Clock value                      | Non-negative integer milliseconds                                        |
| Mode                             | Literal `blitz` in v1                                                    |

Client timestamps are diagnostic only. Server/PostgreSQL time decides expiry, clocks, ordering, and terminal results.

## 3. Canonical enums

### Game status

`CREATED | WAITING_FOR_PLAYERS | READY | IN_PROGRESS | RECONNECTING | COMPLETED | ABANDONED | EXPIRED`

### Result

`white_win | black_win | draw | void`

### Termination

`checkmate | stalemate | insufficient_material | threefold_repetition | fifty_move | resignation | timeout | abandonment | double_abandon | no_show`

### Color

Wire color values are `white | black`. Persistence/engine values may use `w | b` internally.

### Error codes

| Code                           | Meaning                                        | Retry                          |
| ------------------------------ | ---------------------------------------------- | ------------------------------ |
| `UNAUTHORIZED`                 | Missing, invalid, expired, or revoked identity | after obtaining valid session  |
| `INVALID_PAYLOAD`              | Envelope or payload failed strict validation   | no, fix request                |
| `UNSUPPORTED_PROTOCOL_VERSION` | `protocolVersion` is not supported             | no, upgrade client             |
| `UNSUPPORTED_EVENT`            | Event name/type is unknown                     | no, fix client                 |
| `IDEMPOTENCY_KEY_REUSED`       | Key was used for a different command/actor     | no, generate a new key         |
| `ALREADY_QUEUED`               | Guest is already queued                        | semantic success/current state |
| `ALREADY_IN_GAME`              | Guest has a durable active assignment          | recover active game            |
| `GAME_NOT_FOUND`               | Game does not exist or is no longer available  | usually no                     |
| `GAME_ALREADY_ENDED`           | Another valid terminal transition won          | sync snapshot                  |
| `NOT_A_PLAYER`                 | Authenticated guest is not a game member       | no                             |
| `NOT_YOUR_TURN`                | Guest's color is not on turn                   | after opponent move            |
| `ILLEGAL_MOVE`                 | Chess rules reject the proposal                | no, choose legal move          |
| `STALE_GAME_VERSION`           | Client expected version is old                 | yes, after sync                |
| `CLOCK_EXPIRED`                | Authoritative clock expired before move        | no, game will be terminal      |
| `RATE_LIMITED`                 | Scope limit exceeded                           | after `retryAfterMs`           |
| `SERVICE_UNAVAILABLE`          | Dependency or instance is degraded/draining    | yes with backoff               |
| `INTERNAL_ERROR`               | Safe fallback for an unexpected failure        | yes with backoff               |

`DUPLICATE_MOVE` is a metric/internal classification, not a wire failure. A repeated accepted `clientMoveId` returns the original `move.accepted` success.

## 4. Socket.IO envelope

All C→S and S→C events use:

```ts
interface Envelope<T> {
  protocolVersion: 1;
  eventId: string;
  type: string;
  timestamp: number;
  correlationId?: string;
  gameId?: string;
  gameVersion?: number;
  clientMoveId?: string;
  payload: T;
}
```

Rules:

- Socket.IO event name must equal `type`.
- Inbound objects and payloads are strict; unknown fields fail validation.
- C→S `eventId` is reused for a retry of the same semantic command.
- S→C events receive a new server event ID.
- `gameVersion` on server game events is authoritative.
- `gameVersion` on client game commands is the client's `expectedVersion` when required.
- `clientMoveId` appears only on move submission/outcome events.
- `gameId` is required for game commands except `game.sync`, where it may be omitted to recover the guest's active game.

## 5. Acknowledgements

Every C→S event requires a Socket.IO acknowledgement.

### Success

```ts
interface AckSuccess<T> {
  ok: true;
  protocolVersion: 1;
  requestEventId: string;
  correlationId: string;
  type: string;
  gameVersion?: number;
  payload: T;
}
```

### Failure

```ts
interface AckFailure {
  ok: false;
  protocolVersion: 1;
  requestEventId: string;
  correlationId: string;
  type: 'server.error' | 'move.rejected';
  gameVersion?: number;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    authoritativeVersion?: number;
  };
}
```

An acknowledgement is the authoritative command result for the caller. It does not prove that every room recipient received a broadcast.

## 6. Client-to-server events

### `queue.join`

Envelope:

- `gameId`: forbidden
- `gameVersion`: forbidden
- `clientMoveId`: forbidden

Payload:

```ts
{
  mode: 'blitz';
}
```

Success type: `queue.joined`

```ts
{
  mode: 'blitz';
  since: number;
  position?: number;
}
```

`position` is advisory and may be omitted because concurrent queue activity makes it approximate.

### `queue.leave`

Payload:

```ts
{
  mode: 'blitz';
}
```

Success type: `queue.left`

```ts
{
  mode: 'blitz';
  reason: 'requested' | 'matched' | 'disconnected' | 'timeout' | 'stale';
}
```

Leaving when already absent is a semantic success with current queue state.

### `game.ready`

Envelope:

- `gameId`: required
- `gameVersion`: required as expected version

Payload:

```ts
{
}
```

Success type: `game.snapshot`. Repeating readiness returns the current snapshot and does not transition twice.

### `move.submit`

Envelope:

- `gameId`: required
- `gameVersion`: required as `expectedVersion`
- `clientMoveId`: required

Payload:

```ts
{
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}
```

Success type: `move.accepted` with the same authoritative payload sent to the room.

Failure type: `move.rejected`.

### `game.resign`

Envelope:

- `gameId`: required
- `gameVersion`: required as `expectedVersion`
- `eventId`: durable command idempotency key

Payload:

```ts
{
}
```

Success type: `game.ended`.

### `game.sync`

Envelope:

- `gameId`: optional; if absent, recover the guest's active assignment
- `gameVersion`: optional known version

Payload:

```ts
{
}
```

Success type is the complete `game.snapshot` or `session.ready` when no active game exists.

### `heartbeat.ping`

Payload:

```ts
{ lastKnownGameVersion?: number }
```

Success type: `heartbeat.pong`.

```ts
{
  serverTime: number;
  presenceExpiresInMs: number;
}
```

## 7. Server-to-client events

### Shared public player

```ts
interface PublicPlayer {
  name: string;
  avatar: string;
  color: 'white' | 'black';
  connected: boolean;
}
```

### `session.ready`

```ts
{
  guest: {
    id: string;
    name: string;
    avatar: string;
    expiresAt: string;
  }
  activeGameId: string | null;
}
```

### `queue.joined`

Uses the payload in §6.

### `queue.left`

Uses the payload in §6.

### `match.found`

Envelope requires `gameId` and authoritative `gameVersion`.

```ts
{
  color: 'white' | 'black';
  opponent: {
    name: string;
    avatar: string;
  }
  timeControl: {
    initialMs: number;
    incrementMs: number;
  }
  joinDeadline: number;
}
```

### `game.snapshot`

```ts
{
  status: GameStatus;
  you: PublicPlayer;
  opponent: PublicPlayer;
  initialFen: string;
  currentFen: string;
  turn: 'white' | 'black';
  moves: Array<{
    ply: number;
    san: string;
    uci: string;
    color: 'white' | 'black';
  }>;
  clocks: {
    whiteMs: number;
    blackMs: number;
    running: 'white' | 'black' | null;
    serverTime: number;
  }
  result: Result | null;
  termination: Termination | null;
}
```

Envelope `gameVersion` is authoritative. Snapshot move count is not assumed to equal game version.

### `game.started`

```ts
{
  initialFen: string;
  turn: 'white';
  clocks: {
    whiteMs: number;
    blackMs: number;
    running: 'white';
    serverTime: number;
  }
}
```

### `move.accepted`

```ts
{
  ply: number;
  san: string;
  uci: string;
  fenAfter: string;
  turn: 'white' | 'black';
  clocks: {
    whiteMs: number;
    blackMs: number;
    running: 'white' | 'black' | null;
    serverTime: number;
  }
  check: boolean;
}
```

Envelope includes authoritative `gameVersion` and the submitted `clientMoveId`.

### `move.rejected`

Uses `AckFailure.error` as its payload for targeted event delivery. It is never broadcast to the opponent.

### `player.disconnected`

```ts
{
  color: 'white' | 'black';
  graceDeadline: number;
  clocksContinue: true;
}
```

### `player.reconnected`

```ts
{
  color: 'white' | 'black';
}
```

The reconnecting player also receives `game.snapshot`.

### `game.ended`

```ts
{
  result: Result;
  termination: Termination;
  finalFen: string;
  pgn: string;
  clocks: {
    whiteMs: number;
    blackMs: number;
    running: null;
    serverTime: number;
  }
}
```

### `heartbeat.pong`

Uses the payload in §6.

### `server.error`

```ts
{
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}
```

## 8. HTTP contract

### Common headers

| Header             | Rule                                           |
| ------------------ | ---------------------------------------------- |
| `Content-Type`     | `application/json` for JSON requests           |
| `Authorization`    | Bearer JWT for authenticated endpoints         |
| `X-Correlation-Id` | Optional UUIDv4; invalid values are replaced   |
| `Idempotency-Key`  | Required UUIDv4 for session create/renew/reset |

Every JSON success includes `correlationId`.

Common error:

```ts
{
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  };
  correlationId: string;
}
```

### `POST /v1/session`

- Auth: none
- Required header: `Idempotency-Key`
- Body: `{}`
- Rate limit: 10/min/IP
- Status: `201` on first execution, `200` on replay

Response:

```ts
{
  token: string;
  guest: {
    id: string;
    name: string;
    avatar: string;
    expiresAt: string;
  }
  correlationId: string;
}
```

### `POST /v1/session/renew`

- Auth: guest JWT
- Required header: `Idempotency-Key`
- Body: `{}`
- Rate limit: 30/min/guest
- Status: `200`

Response:

```ts
{
  token: string;
  expiresAt: string;
  correlationId: string;
}
```

### `GET /v1/session`

- Auth: guest JWT
- Rate limit: 60/min/guest
- Status: `200`

Response:

```ts
{
  guest: {
    id: string;
    name: string;
    avatar: string;
    issuedAt: string;
    expiresAt: string;
  }
  correlationId: string;
}
```

### `POST /v1/session/reset`

- Auth: guest JWT
- Required header: `Idempotency-Key`
- Body: `{}`
- Rate limit: 10/min/guest
- Status: `200`

Response:

```ts
{
  ok: true;
  correlationId: string;
}
```

### `GET /v1/games/active`

- Auth: guest JWT
- Rate limit: 60/min/guest
- Status: `200`

Response:

```ts
{
  gameId: string | null;
  correlationId: string;
}
```

### `GET /v1/games/:id/snapshot`

- Auth: guest JWT and game membership
- Rate limit: 120/min/guest
- Status: `200`, `401`, `403`, or `404`
- Response: the `game.snapshot` payload plus `gameId`, `gameVersion`, and `correlationId`

### `GET /healthz`

- Auth: none; edge may restrict
- Purpose: process liveness only
- Status: `200` while the process can serve its event loop

```ts
{
  status: 'ok';
}
```

### `GET /readyz`

- Auth: none; edge restricts in production
- Purpose: routing readiness
- Status: `200` when ready, otherwise `503`

```ts
{
  status: 'ok' | 'degraded' | 'draining';
  deps: {
    db: 'up' | 'down';
    redis: 'up' | 'down';
  }
}
```

### `GET /metrics`

- Prometheus text format
- Internal network only
- Never exposed through the public production route

## 9. HTTP status mapping

| Condition                                                 | Status |
| --------------------------------------------------------- | -----: |
| Invalid payload/header                                    |  `400` |
| Unauthorized/revoked/expired                              |  `401` |
| Authenticated non-member                                  |  `403` |
| Not found                                                 |  `404` |
| Idempotency key conflict/stale version/game already ended |  `409` |
| Rate limited                                              |  `429` |
| Dependency/draining                                       |  `503` |
| Unexpected safe failure                                   |  `500` |

## 10. Reliability and ordering

- Socket.IO preserves order for delivered events but does not guarantee arrival.
- Clients wait for an acknowledgement and retry a missing ack with the same identifiers.
- Clients deduplicate server events by `eventId`.
- Clients treat `gameVersion < localVersion` as stale delivery unless the event is a full snapshot.
- Clients allow multiple idempotent companion events at `gameVersion == localVersion` (for example `move.accepted` followed by `game.ended`) and deduplicate them by `eventId`/event semantics.
- Clients treat `gameVersion > localVersion + 1` as a gap and call `game.sync`.
- Lifecycle transitions may increment version without adding a move.
- A complete snapshot replaces the client's game model.
- Commit precedes acknowledgement and broadcast for durable changes.
- Connection-state recovery is an optimization; snapshot recovery is authoritative.

## 11. Compatibility rules

- Clients must ignore unknown fields in server responses/events.
- The server rejects unknown inbound fields under protocol v1.
- New optional server response fields are v1-compatible.
- New optional client fields require server support before use.
- Removing, renaming, changing meaning, or making an optional field required creates protocol v2.
