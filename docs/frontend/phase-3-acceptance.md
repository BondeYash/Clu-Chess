# Frontend Phase 3 Acceptance

> **Status:** Accepted
> **Date:** 2026-07-28
> **Roadmap:** [`../../FRONTEND_PLAN.md`](../../FRONTEND_PLAN.md)
> **Runtime contract:** [`session-lifecycle.md`](session-lifecycle.md)

## Delivered session foundation

- A single typed REST boundary supplies credential inclusion, request timeout
  and caller abort behavior, correlation IDs, content-aware JSON handling,
  protocol-v1 Zod validation, structured `ApiError`, `Retry-After` parsing, and
  redaction helpers.
- The session endpoint adapter wires create, read, renew, reset, and active-game
  lookup without exposing transport details to React.
- `SessionCoordinator` implements bearer-first/cookie-fallback recovery,
  creation only on guest routes, near-expiry renewal, a renewal schedule,
  active-game safety hints, and single-flight bootstrap escalation.
- Create, renew, and reset mutations retry at most three times, retain one
  idempotency key across uncertain/retryable outcomes, honor rate-limit delays,
  and cap backoff.
- The root provider publishes only a token-free session view through TanStack
  Query. The guest layout gate renders distinct loading, recovery failure,
  identity-lost, anonymous, and ready states.
- The landing CTA is recovery-aware without creating an unsolicited identity.
  `/play` renders the live generated guest and expiry. `/settings` renders the
  live identity and performs server-confirmed reset with destructive warning,
  pending, failure-reference, and success states.
- Application chrome now reflects real guest name/avatar and distinguishes
  session readiness from the Phase 4 socket connection state.

## Storage and safety decisions

- Bearer/socket tokens, active-game hints, and pending mutation keys are scoped
  to the current tab in `sessionStorage`, with memory fallback if storage is
  unavailable.
- Tokens are absent from Query data, URLs, `localStorage`, IndexedDB, console
  output, and error presentation.
- Feature code is lint-blocked from direct `fetch`, `localStorage`, and
  IndexedDB access.
- Rejected bearer recovery clears the bearer and attempts the backend-owned
  HttpOnly cookie exactly once before considering identity creation.
- An active-game hint prevents automatic guest creation when identity proof is
  lost; the UI asks the visitor to retry recovery instead.
- Reset clears old state only after backend confirmation. Failed or exhausted
  retryable resets retain the prior token and replay key.

## Acceptance evidence

| Gate                                  | Result                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Formatting, ESLint, strict TypeScript | Pass                                                                                                  |
| Unit/component/contract suite         | 11 files, 57 tests passed                                                                             |
| Frontend coverage                     | 89.03% statements, 81.45% branches, 93.44% functions, 91.23% lines                                    |
| Chromium E2E                          | 18 tests passed, including four Phase 3 lifecycle journeys                                            |
| Phase 3 accessibility                 | Zero WCAG 2 A/AA violations in the reset dialog and identity-lost route                               |
| Session security assertions           | Token absent from Query cache, URL, logs, and `localStorage`; present only per tab                    |
| Retry assertions                      | Lost create response, `429`, and `503` reuse one UUID across at most three attempts                   |
| Existing visual regression            | Approved 320, 390, 768, 1024, and 1440 px baselines passed                                            |
| Live backend create                   | `GET /v1/session` 401 safely progressed to one idempotent `POST /v1/session` 201                      |
| Live active-game lookup               | Authenticated `GET /v1/games/active` returned 200; backend log redacted bearer/cookie                 |
| Live cookie recovery                  | Clearing the tab token and reloading preserved identity and restored a renewed tab token              |
| Local demonstration                   | Frontend remains live at `http://localhost:5173`; backend remains separate at `http://localhost:3300` |

## Acceptance criteria

- [x] Refresh/cookie recovery preserves the valid guest and does not create a
      second identity.
- [x] First-visit and concurrent navigation paths create at most one guest.
- [x] Bounded create, renew, and reset retries reuse their original
      idempotency keys.
- [x] Reset confirmation clears the prior guest cache, token, active hint, and
      pending operation keys only after server success.
- [x] Active identity expiry/loss never silently moves a possible in-progress
      game to a replacement guest.
- [x] Loading, `401`, `429`, `503`, invalid response, timeout, network, reset
      success, and reset failure states have safe behavior and plain-language
      presentation.
- [x] Session credentials remain outside origin-wide persistence, URLs, query
      state, and UI/log output.

Phase 4 may now add one authenticated realtime connection, authoritative game
recovery, and socket-aware navigation on top of this token boundary.
