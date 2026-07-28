# Frontend Phase 4 Acceptance

> **Status:** Accepted
> **Date:** 2026-07-28
> **Roadmap:** [`../../FRONTEND_PLAN.md`](../../FRONTEND_PLAN.md)
> **Runtime contract:** [`realtime-recovery.md`](realtime-recovery.md)

## Delivered realtime and recovery core

- A lazy `RealtimeClient` opens exactly one authenticated Socket.IO connection
  and heartbeat timer for a ready guest on a valid UUID game route.
- The client constructs strict protocol-v1 commands and validates supported
  server events and acknowledgements before publishing them.
- A bounded event-ID LRU de-duplicates delivery. Transport telemetry counts
  received, duplicate, invalid, timeout, and reconnect outcomes without
  collecting payloads or identifiers.
- Connection, reconnect, heartbeat, unavailable, and safely mapped issue states
  live in a transport-only Zustand store.
- `session.ready` is reconciled against REST identity and an independent
  `GET /v1/games/active` result. Identity disagreement fails closed.
- `game.sync` uses a cached version when available and falls back to active-game
  plus HTTP snapshot recovery when the socket cannot confirm state.
- A complete snapshot replaces the game Query cache. Terminal snapshots clear
  active-game navigation; transport loss never clears the last safe board.
- Token renewal updates the same socket identity. Renewal failure becomes a
  safe, recoverable transport state without exposing server or credential
  details.

## Delivered UI and routing

- `/game/demo` remains a fixture route while `/game/:uuid` renders the
  authoritative recovery screen.
- Invalid IDs use the product not-found boundary and perform no snapshot call.
- Non-member and missing-game responses share one privacy-safe screen.
- Real active-game capability changes desktop/mobile navigation from Play to
  Resume and adds explicit resume actions in the lobby.
- The app header badge reflects session readiness, connecting, connected,
  reconnecting, and unavailable state.
- A correlated reconnect/recovery banner preserves the underlying game and
  exposes one bounded recovery action.
- The recovery screen shows oriented board, real player bars/clocks, status,
  version, and a keyboard-focusable move history while keeping move and resign
  mutations disabled until their implementation phases.
- Desktop recovery details and transport feedback use coordinated sticky
  positions. Tablet, mobile, short viewport, and zoom-equivalent layouts return
  them to normal flow. Move history owns bounded scroll without trapping page
  scroll.

## Security and privacy evidence

- Socket tokens remain behind the per-tab session storage adapter and are never
  added to URLs, Query data, Zustand, rendered state, or telemetry.
- Dynamic route validation rejects malformed game IDs before an API request.
- `403`/`404` UI omits opponent, board, clock, move, game-status, and raw backend
  error details.
- The transport banner maps server codes to approved product language and
  displays only a safe correlation ID.
- Invalid FEN, event, acknowledgement, or event-name/type combinations are not
  rendered as authoritative state.

## Acceptance evidence

| Gate                                  | Result                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Formatting, ESLint, strict TypeScript | Pass                                                                                                             |
| Unit/component/contract suite         | 19 files, 101 tests passed                                                                                       |
| Frontend coverage                     | 90.94% statements, 82.48% branches, 95.13% functions, 92.86% lines                                               |
| Complete Chromium E2E                 | 24 tests passed across foundation and Phases 2–4                                                                 |
| Phase 4 Chromium scenarios            | 6 passed: recovery, responsive reflow, transport loss, privacy, resume navigation, invalid deep link             |
| Accessibility                         | Zero WCAG 2 A/AA automated violations on recovered-game and private-failure routes                               |
| Sticky geometry                       | Browser assertion proves recovery details remain below the sticky reconnect banner                               |
| Scroll behavior                       | Browser assertion proves move history overflows independently, receives keyboard focus, and scrolls              |
| Visual regression                     | Approved Phase 2 baselines plus desktop and 768 px recovery baselines                                            |
| Production qualification              | Next.js production build and Storybook static build passed                                                       |
| Shared protocol regression            | Format, typecheck, 6 tests, and package build passed                                                             |
| Backend regression                    | Format, lint, typecheck, 123 tests, coverage thresholds, and production build passed                             |
| Live realtime smoke                   | Fresh guest received matching `session.ready`; heartbeat returned `heartbeat.pong`; token absent from event/ack  |
| Live privacy smoke                    | Authenticated random private snapshot returned 404 without affecting the session                                 |
| Dependency audit                      | 0 known npm vulnerabilities                                                                                      |
| Local demonstration                   | Frontend live at `http://localhost:5173`; backend live separately at `http://localhost:3300` on this workstation |

## Acceptance criteria

- [x] Exactly one socket and one heartbeat timer exist for a guest identity in a
      tab.
- [x] Socket middleware failure and terminal reconnect failure have explicit,
      retryable UI states.
- [x] Duplicate and malformed server events cannot advance feature state.
- [x] Mismatched, malformed, and timed-out acknowledgements fail safely.
- [x] Reconnect and `session.ready` disagreement converge through independent
      HTTP active-game/snapshot reads.
- [x] A refresh or deep link can restore the authoritative board, players,
      clocks, moves, status, and game version.
- [x] Transport loss keeps the last confirmed board visible.
- [x] Private deep-link failures disclose no game or opponent detail.
- [x] Sticky regions never overlap and become normal-flow for narrow or short
      viewports.
- [x] The move list scrolls independently without trapping document scroll.
- [x] Realtime code stays deferred outside an authenticated UUID game route.

Phase 5 may now implement authoritative queue join/leave, queue intent recovery,
match-found navigation, and active-game precedence on this transport boundary.
