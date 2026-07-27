# Realtime Operations

> **Status:** Implemented through Phase 6
> **Protocol authority:** [`protocol-v1.md`](protocol-v1.md)

## Runtime topology

CluChess exposes one Socket.IO namespace at `/`. The application uses the
Redis Streams adapter on every instance from startup, including local Docker
Compose. The adapter creates its own blocking reader and subscription
connections from a dedicated realtime Redis client; normal Redis commands use
the shared command client.

WebSocket is preferred. A deployment that permits polling across replicas must
provide sticky sessions. Production handshakes require an exact HTTPS origin
from `ORIGIN_ALLOWLIST` and a secure connection, either direct TLS or the
trusted ingress `X-Forwarded-Proto: https` signal.

No host datastore, environment file, key generation, or external account is
needed:

```bash
docker compose up --build
```

## Connection lifecycle

1. Create or recover a guest through `POST /v1/session`.
2. Connect with `auth.token` set to the returned JWT and an allowed `Origin`.
3. The server verifies signature, expiry, key ID, and Redis revocation state.
4. The authenticated identity is frozen in `socket.data`; the handshake token
   is removed after verification.
5. Presence is added and the socket joins `guest:{guestId}`.
6. `session.ready` reports the public guest and the authoritative PostgreSQL
   `activeGameId` hint.

Authentication fails closed when revocation state cannot be consulted. Missing,
malformed, expired, forged, and revoked tokens all return the same safe
`UNAUTHORIZED` classification. Resetting a session disconnects its currently
reachable sockets.

## Command boundary

Every client command must:

- use a supported event name matching envelope `type`;
- use `protocolVersion: 1`;
- contain a UUIDv4 client `eventId`;
- pass its strict Zod envelope and payload schema;
- remain within `MAX_WS_BUFFER_BYTES`, at most 8192 for v1;
- include a Socket.IO acknowledgement callback.

The acknowledgement repeats the request event ID, carries a generated or
propagated correlation ID, and is the authoritative response to that caller.
Unexpected failures are mapped to stable public errors; tokens, raw private
payloads, Redis URLs, and database details are never included.

The command port handles heartbeat, FIFO queue join/leave, `game.ready`, and
guest-authorized `game.sync`. Matchmaking publishes `queue.left` and
`match.found` through personal rooms across replicas. `move.submit` and
`game.resign` remain validated and rate-limited but return
`SERVICE_UNAVAILABLE` until Phase 7 installs the authoritative gameplay
transaction.

## Presence and heartbeats

Presence is stored in a Redis sorted set:

```text
presence:{guestId}
  member = {instanceId}:{socketId}
  score  = expiry epoch milliseconds
```

`heartbeat.ping` refreshes both this member and the transient per-address
connection member. If a matchmaking queue guard exists, its TTL is refreshed
in the same presence script. Expired members are pruned atomically.

Multiple tabs create multiple members. Closing one tab leaves the guest
present while another live member remains; the final disconnect deletes the
empty presence key and invokes the replaceable final-disconnect observer for
later game phases.

## Delivery and recovery

Application services depend on the realtime delivery port, not Socket.IO.
`BroadcastService` routes public events to `guest:{guestId}` and
`game:{gameId}` rooms. When the adapter Redis connection is healthy, delivery
uses Redis Streams across all instances and attaches recovery offsets. When
that connection is degraded, delivery switches to local-only routing so
same-instance clients are not held behind Redis; cross-instance delivery
resumes when the adapter reconnects.

Connection-state recovery is bounded by
`SOCKET_RECOVERY_MAX_DISCONNECTION_MS`. Authentication middleware always runs
again on a recovered connection (`skipMiddlewares: false`) so revocation is
not bypassed. PostgreSQL remains authoritative; recovery never treats a room,
presence member, or stream entry as game truth.

Match allocation and readiness recovery details are in
[`matchmaking-operations.md`](matchmaking-operations.md).

## Verification

Run all static, unit, coverage, and build gates:

```bash
docker compose run --build --rm app npm run verify
```

Run the real PostgreSQL/Redis and multi-instance transport suite:

```bash
sh scripts/run-integration-tests.sh
```
