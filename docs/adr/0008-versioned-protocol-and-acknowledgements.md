# ADR 0008: Strict versioned protocol and acknowledgements

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** H — Protocol and acknowledgement contract

## Context

Socket.IO event names, envelope types, acknowledgement responses, retry identifiers, timestamps, and compatibility behavior must be fixed before gateway handlers and clients are implemented.

## Decision

The normative transport contract is [`../protocol-v1.md`](../protocol-v1.md).

### Core rules

- Use the single Socket.IO default namespace.
- The Socket.IO event name must exactly equal envelope `type`.
- Every message uses `protocolVersion: 1`.
- All inbound Zod objects are strict; unknown fields are rejected.
- An unsupported version returns `UNSUPPORTED_PROTOCOL_VERSION`.
- An unknown event returns `UNSUPPORTED_EVENT`.
- Maximum decoded Socket.IO message size is 8 KiB.
- Client timestamps are diagnostic only. Server/PostgreSQL time decides clocks, expiry, ordering, and results.
- Clients generate UUIDv4 `eventId` values and reuse them on retry.
- Servers generate a new UUIDv4 for every outbound event.
- `move.submit` additionally requires a stable UUIDv4 `clientMoveId`.
- Durable game commands carry `expectedVersion`.
- `gameId`, actor, color, turn, result, and version are never trusted from payload data.

### Acknowledgements

Every C→S event uses a Socket.IO acknowledgement.

Success:

```json
{
  "ok": true,
  "protocolVersion": 1,
  "requestEventId": "uuid",
  "correlationId": "uuid",
  "type": "move.accepted",
  "gameVersion": 5,
  "payload": {}
}
```

Failure:

```json
{
  "ok": false,
  "protocolVersion": 1,
  "requestEventId": "uuid",
  "correlationId": "uuid",
  "type": "move.rejected",
  "gameVersion": 4,
  "error": {
    "code": "STALE_GAME_VERSION",
    "message": "The game state changed; synchronize and retry.",
    "retryable": true
  }
}
```

An acknowledgement is the command result, not proof that every room recipient received the corresponding broadcast. Missing acknowledgements are retried with the same identifiers. Duplicate accepted moves return the original success and are not surfaced as a `DUPLICATE_MOVE` failure.

### Compatibility

- Additive server response fields are allowed within protocol v1; clients must ignore unknown response fields.
- The server remains strict for inbound v1 fields to catch client mistakes.
- Removing/renaming fields, changing meaning, or changing requiredness needs protocol v2.
- Protocol v1 never silently coerces a v2 message.

## Invariants

- One command retry is identifiable across sockets/instances.
- Event name and typed payload cannot disagree.
- Client clock data cannot affect authoritative gameplay.
- Clients can repair missed/duplicate broadcasts using event IDs and game versions.

## Consequences

- The gateway owns envelope/ack validation and delegates only validated domain inputs.
- Protocol fixtures become shared test vectors for backend and frontend.
- A separate protocol version is required for breaking changes.

## Verification

- Contract tests cover every event and acknowledgement in `protocol-v1.md`.
- Fuzz malformed, oversized, unknown-field, unknown-event, and wrong-version messages.
- Retry every state-changing event and compare its semantic outcome.
- Detect a skipped game version and recover with `game.sync`.
