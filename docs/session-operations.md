# Guest Session Operations

## Runtime contract

The anonymous session system is ready after the normal zero-touch startup:

```bash
docker compose up --build
```

PostgreSQL is the durable authority for guests and idempotent session commands.
Redis contains only expiring name reservations, rate counters, and JWT
revocation keys. The API exposes:

| Route                    | Auth                       | Idempotency key | Result                                |
| ------------------------ | -------------------------- | --------------- | ------------------------------------- |
| `POST /v1/session`       | none                       | required UUIDv4 | creates or replays one identity/token |
| `POST /v1/session/renew` | bearer JWT or guest cookie | required UUIDv4 | replays or issues a new `jti`         |
| `GET /v1/session`        | bearer JWT or guest cookie | none            | approved public session fields        |
| `POST /v1/session/reset` | bearer JWT or guest cookie | required UUIDv4 | revokes every token for that guest    |

All mutation bodies are exactly `{}`. Every success and error contains a
correlation ID. The token is returned for Socket.IO bootstrap and, when enabled,
is also delivered as an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie. The cookie
is `Secure` outside local HTTP development.

## Token and key lifecycle

Guest tokens use Ed25519 with the exact version-1 claims described in
`protocol-v1.md`. The default lifetime is 12 hours. Renewal creates a new `jti`,
but earlier tokens remain valid until their own expiry unless the guest is
reset.

For a signing-key rotation:

1. mount the new private key and add its public key as `<new-kid>.pem`;
2. keep every still-valid retiring public key in `JWT_PUBLIC_KEYS_DIR`;
3. change `JWT_KID` to the new key ID and roll the app replicas;
4. retain old public keys for at least
   `JWT_TTL_SECONDS + JWT_CLOCK_SKEW_SECONDS`;
5. remove the retiring public key only after that overlap.

Private keys are never written to environment values, logs, or image layers.
Token, cookie, authorization, `jti`, key, and credential fields are redacted.

## Reset and dependency behavior

Reset commits `revoked_at` and its `session_commands` replay record in one
PostgreSQL transaction. It then writes both the session-wide Redis revocation
key and the presented-token denylist key, and invokes the guest socket
disconnect port. Phase 4 will connect that port to the realtime transport.

The same reset key can be replayed with the now-revoked token. A different
command or guest using that key receives `409 IDEMPOTENCY_KEY_REUSED`; a new
reset key with the revoked token receives `401 UNAUTHORIZED`.

Authentication fails closed with `503 SERVICE_UNAVAILABLE` if Redis revocation
state cannot be checked. Session mutations return 503 when PostgreSQL is
unavailable. PostgreSQL queries have both server- and client-side bounded
timeouts. Startup and the periodic reconciliation job restore missing
session-wide revocation keys from durable revoked rows in cursor-based batches.

## Retention and privacy

The cleanup job deletes expired guest rows only after the configured retention
period, 30 days by default. It skips any guest referenced by a retained game,
active assignment, move, or game command. Its associated session-command rows
are removed in the same transaction.

No persistent IP address, device identifier, fingerprint, email, or account
profile is collected. Session-create rate limiting hashes the transient client
address and keeps that digest in Redis only for the rate window. Display-name
reservations expire after 24 hours; PostgreSQL's case-insensitive unique
constraint remains the final name authority.
