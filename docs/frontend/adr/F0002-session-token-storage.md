# ADR F0002: Per-tab socket token storage and renewal

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Frontend and security engineering

## Context

REST can authenticate with the backend's HttpOnly cookie, while Socket.IO v1
requires a JavaScript-supplied `auth.token`. The backend architecture describes
a `localStorage` mirror, but a long-lived origin-wide token increases exposure
and cross-tab coupling.

## Decision

- Keep the HttpOnly cookie as the REST session anchor.
- Store the socket JWT in memory and `sessionStorage` for the current tab.
- Never place JWTs in `localStorage`, IndexedDB, URLs, Query caches, analytics,
  error reports, or logs.
- When the cookie is valid but a tab has no token, call
  `POST /v1/session/renew` with a stable pending idempotency key.
- Renew approximately five minutes before `expiresAt`.
- Store pending create/renew/reset idempotency keys in `sessionStorage` until a
  final outcome is known.
- On a bearer `401`, clear the bearer and retry `GET /v1/session` once using the
  cookie alone before creating a new guest.
- A `401` during an active game stops commands and explains identity loss; it
  must not silently create a new identity inside the old game.

## Rejected alternatives

- **`localStorage` JWT:** rejected because it persists across browser sessions
  and is available to every same-origin tab.
- **Memory only:** rejected because a normal refresh would require renewal on
  every load and make recovery unnecessarily fragile.
- **Cookie-only Socket.IO auth:** unavailable in backend protocol v1.

## Consequences

- Each tab owns a socket token while the backend still treats multiple tabs as
  one guest presence.
- A reopened browser may perform one cookie-backed renewal.
- XSS can still access the active tab token, so strict CSP and no unsafe HTML
  remain required.

## Verification

- Storage tests assert JWT absence from `localStorage`, IndexedDB, URL, and
  Query state.
- Refresh preserves identity and reconnects.
- Cookie-valid/token-missing bootstrap renews rather than creates.
- Reset clears token, pending keys, guest caches, and socket state.
