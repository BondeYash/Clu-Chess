# ADR F0003: Native Fetch REST abstraction

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Frontend engineering

## Context

The frontend needs one typed REST boundary usable in browser and server
contexts. The API surface is small, JSON-first, credentialed, and already
specified with Zod-compatible contracts.

## Decision

Use native `fetch` behind `apiFetch`.

`apiFetch` owns:

- local versus production base URL resolution;
- `credentials: 'include'`;
- `Accept`, conditional `Content-Type`, bearer, correlation, and idempotency
  headers;
- abort/timeout composition;
- content-type-aware parsing;
- Zod success/error validation;
- a typed `ApiError` containing status, public code, retryability, retry delay,
  and correlation ID;
- mandatory credential/header redaction.

It performs no automatic retries. Query and mutation hooks own policy because
only they know whether an identifier can be safely reused.

## Rejected alternatives

- **Axios:** rejected because the platform API already covers the required
  behavior and another interception/cancellation model adds weight.
- **Direct `fetch` in components:** rejected because it duplicates credentials,
  validation, timeouts, and error mapping.
- **Next.js Data Cache for guest/game state:** rejected because live identity and
  game data are browser/session specific and event-updated.

## Consequences

- REST behavior is vendor-light and consistent.
- Feature hooks remain explicit about retry and invalidation.
- Tests can replace the fetch boundary or use MSW.

## Verification

- Tests cover JSON success/error, non-JSON failure, timeout, abort, `401`,
  `429`, `503`, correlation propagation, credentials, and redaction.
- No feature component calls raw `fetch`.
