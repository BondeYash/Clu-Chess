# ADR 0005: Session token renewal, idempotency, and revocation

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** E — Session renewal and revocation semantics

## Context

Socket handshakes should verify a guest without a PostgreSQL read, while session creation, renewal, reset, retries, and signing-key rotation still need deterministic behavior. A `current_jti` column alone neither makes renewal idempotent nor revokes every still-live token issued before the latest renewal.

## Decision

### Token validity

- Access tokens are Ed25519 JWTs with a 12-hour default lifetime.
- A renewal issues a new `jti`, `iat`, and `exp`.
- Previously issued tokens remain valid until their own expiry unless the session or that `jti` is revoked. Renewal is not a refresh-token rotation mechanism.
- `guest_sessions.current_jti`, `issued_at`, and `expires_at` describe the latest issuance.
- The JWT `v` claim is the token schema version; `kid` selects the verification key.

This avoids a cross-datastore race that could invalidate the credential needed to retry a renewal whose response was lost.

### Durable HTTP idempotency

`Idempotency-Key` is a required UUID header for:

- `POST /v1/session`;
- `POST /v1/session/renew`;
- `POST /v1/session/reset`.

Add a `session_commands` table:

| Column                     | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `id`                       | UUID primary key                                |
| `command_type`             | `create`, `renew`, or `reset`                   |
| `idempotency_key_hash`     | SHA-256 of the normalized key                   |
| `guest_id`                 | Guest affected by the command                   |
| `issued_jti`               | Token issuance returned by create/renew, if any |
| `issued_at` / `expires_at` | Exact token claims returned by create/renew     |
| `created_at`               | Audit/retention timestamp                       |

`UNIQUE(idempotency_key_hash)` makes retries return the same guest and issuance claims. Reuse of a key for a different authenticated guest or command returns `IDEMPOTENCY_KEY_REUSED`.

Guest/session mutation and command-row creation occur in one PostgreSQL transaction. JWTs can be regenerated from the persisted guest and issuance claims, so a lost HTTP response does not mint another identity or issuance.

### Revocation

Reset performs:

1. verify the signed token and read the durable session;
2. in one PostgreSQL transaction, create/recover the reset command and set `revoked_at`;
3. write `jwt:revoked-session:{guestId}` in Redis with TTL through the latest possible live-token expiry;
4. optionally write `jwt:denylist:{jti}` for individually revoked credentials;
5. disconnect all guest sockets;
6. if active, apply the explicit-departure game policy from ADR 0006.

All handshakes check both the per-session revocation key and the optional `jti` denylist. PostgreSQL reset state is durable; startup and periodic reconciliation repopulate missing Redis revocation keys for revoked sessions whose tokens may still be live.

### Dependency behavior

- A new handshake fails closed with `SERVICE_UNAVAILABLE` when Redis revocation state cannot be checked.
- Existing authenticated sockets may continue through a brief Redis outage; durable game commands still require PostgreSQL authorization.
- Create, renew, and reset return `503` when PostgreSQL is unavailable.
- Renew and reset return `503` when Redis revocation checks are unavailable.
- If PostgreSQL reset commits but the Redis write fails, the command returns `503`; reconciliation completes revocation and retry returns the same result.
- Reset authentication has one narrow replay exception: after cryptographic token verification, a revoked token may receive the already-completed reset success only when the supplied idempotency key resolves to that same guest's persisted reset command. It cannot execute a new command or access any other endpoint.

### Signing-key rotation

- Sign with exactly one active private key and its unique `kid`.
- Verify with the active public key and retiring public keys.
- Retain a retiring public key for at least the maximum token lifetime plus clock skew.
- Reject unknown `kid`, unexpected algorithms, malformed claims, and unsupported token versions.

### Cookie behavior

When cookie delivery is enabled, use `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` outside local HTTP development. The REST response also returns the token for Socket.IO's `auth` field. The backend never logs either form.

## Invariants

- A retry with the same idempotency key cannot create another guest or issuance.
- Reset revokes all tokens for the anonymous session, not only `current_jti`.
- Handshakes never accept identity without a successful revocation check.
- Signing-key rotation does not invalidate unexpired tokens prematurely.

## Consequences

- Session mutations require PostgreSQL-backed command records.
- Redis is still used for low-latency handshake revocation, but durable revoked state can rebuild it.
- Renewed access tokens overlap until earlier tokens expire.

## Verification

- Retry create/renew/reset after a simulated lost response and receive the same persisted outcome.
- Reuse an idempotency key for another guest and receive `IDEMPOTENCY_KEY_REUSED`.
- Reset, delete the Redis revocation key, run reconciliation, and confirm it is restored.
- Reject handshakes during Redis outage and after reset.
- Verify old and new keys during the rotation overlap, then reject the retired `kid`.
