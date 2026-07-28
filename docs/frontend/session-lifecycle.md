# Anonymous session lifecycle

> **Implemented:** Frontend Phase 3
> **Contract authority:** [`../protocol-v1.md`](../protocol-v1.md)

This document defines how the browser creates, recovers, renews, and resets a
temporary CluChess guest. The backend remains the identity authority. The
frontend only coordinates authenticated requests, per-tab credentials, and
honest UI states.

## Runtime ownership

| Concern                            | Owner                                         | Rule                                                                   |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Guest identity and expiry          | Backend                                       | PostgreSQL and the signed token are authoritative                      |
| REST response validation           | `src/lib/api/api-fetch.ts`                    | Every response crosses a protocol-v1 Zod schema                        |
| Request correlation                | REST boundary                                 | A UUID correlation ID is sent and the server response ID is preserved  |
| Session orchestration              | `SessionCoordinator`                          | Recovery precedes creation; mutations use bounded idempotent retries   |
| Server-state cache                 | TanStack Query                                | Stores the token-free `SessionBootstrapResult` only                    |
| Per-tab secrets and operation keys | `SessionStoragePort`                          | Uses `sessionStorage` with a memory fallback                           |
| Guest route state                  | `GuestSessionProvider` and `GuestSessionGate` | Loading, ready, identity-lost, anonymous, and failure are explicit     |
| Plain-language failures            | `presentApiError`                             | Protocol codes map to stable actions and retain correlation references |

## Bootstrap order

```text
Public landing page
  GET /v1/session (bearer when present, otherwise cookie)
  ├─ valid identity -> renew if token is absent or near expiry
  └─ 401 -> remain anonymous; do not create

Guest route (/play, /settings, /game/:id)
  GET /v1/session
  ├─ rejected bearer -> clear it, retry once with HttpOnly cookie
  ├─ valid cookie but no tab token -> POST /v1/session/renew
  ├─ no identity and active-game hint -> IDENTITY_LOST; never create
  └─ no identity and no active-game hint -> POST /v1/session

Ready identity
  GET /v1/games/active
  ├─ success -> cache token-free guest and active game ID
  └─ non-auth failure -> keep the guest, expose active lookup as unavailable
```

Bootstrap is single-flight. If public cookie recovery is already in progress
when navigation reaches a guest route, the protected request waits for it and
escalates to creation only if that recovery finishes anonymous. This prevents a
navigation race from creating duplicate guests.

## REST integration matrix

| Endpoint                 | Trigger                                               | Authentication                                            | Cache/result behavior                                                                      | Retry and failure behavior                                                                      |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /v1/session`        | Landing or guest-route bootstrap, manual recovery     | Bearer when available; cookie fallback after bearer `401` | Five-minute query freshness; response is normalized into a token-free view                 | Query-level retries are disabled because the coordinator owns bounded recovery                  |
| `POST /v1/session`       | Guest route with no recoverable identity              | Cookie not required; stable `Idempotency-Key`             | Token goes directly to per-tab storage; only guest view data enters Query                  | At most three attempts for retryable network/`429`/`5xx` failures, all with one key             |
| `POST /v1/session/renew` | Cookie recovery, near-expiry bootstrap, renewal timer | Bearer or HttpOnly cookie                                 | Replaces the per-tab token and expiry; never caches the token                              | Same bounded, same-key retry policy; `401` becomes identity-lost                                |
| `GET /v1/games/active`   | Successful identity bootstrap                         | Bearer                                                    | Active ID is included in the session view and mirrored as a safety hint                    | Auth failure becomes identity-lost; other failures preserve identity with an unavailable marker |
| `POST /v1/session/reset` | Confirmed settings action                             | Bearer and stable `Idempotency-Key`                       | Old cache/storage is cleared only after server confirmation, then a fresh guest is created | Dialog remains open on failure; retries reuse the reset key and show safe error copy            |

The coordinator honors `retryAfterMs`/`Retry-After`, caps any wait at five
seconds, and stops after three mutation attempts. Definitive non-retryable
failures clear the pending operation key; an exhausted retryable operation
retains it for a safe later replay.

## Storage and security contract

| Key                            | Contents                      | Lifetime                         |
| ------------------------------ | ----------------------------- | -------------------------------- |
| `cluchess:v1:socket-token`     | Bearer/socket token           | Current browser tab              |
| `cluchess:v1:pending:create`   | Create idempotency UUID       | Until a definitive create result |
| `cluchess:v1:pending:renew`    | Renew idempotency UUID        | Until a definitive renew result  |
| `cluchess:v1:pending:reset`    | Reset idempotency UUID        | Until a definitive reset result  |
| `cluchess:v1:active-game-hint` | Last confirmed active game ID | Until cleared or replaced        |

- The bearer token never appears in TanStack Query data, URLs, UI copy, or
  application logging.
- `localStorage`, IndexedDB, and direct feature-level `fetch` calls are blocked
  by ESLint. The single typed REST boundary is the explicit exception for
  native `fetch`.
- Authorization, cookies, and `Set-Cookie` are redacted by the transport
  logging helper.
- Requests include credentials so the backend-owned HttpOnly cookie can recover
  the session after a reload or when a tab token is absent.
- An active-game hint is not authentication. It only prevents unsafe automatic
  identity replacement when the previous identity cannot be proven.
- Storage access failures fall back to memory for the current document without
  weakening the no-origin-wide-storage rule.

## Reset transaction

1. Keep the current token, Query data, and pending reset key while the server
   outcome is uncertain.
2. Send reset with one key through all bounded retries.
3. On confirmation, clear token, active-game hint, and all pending operation
   keys.
4. Remove guest-scoped session queries.
5. Create and publish the replacement guest.
6. Keep the dialog open with correlation-aware copy if any step fails.

Phase 4 must use `SessionBootstrapResult` as its identity input and retrieve the
socket token through the storage boundary. It must not widen token visibility
by adding it to a query, Zustand store, component prop, URL, or log event.
