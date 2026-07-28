# Realtime Transport and Recovery

> **Status:** Implemented in Phase 4
> **Runtime contract:** [`../protocol-v1.md`](../protocol-v1.md)
> **Decision authority:** [`adr/F0006-realtime-convergence.md`](adr/F0006-realtime-convergence.md)

## Outcome

Phase 4 adds one authenticated Socket.IO connection only when a guest opens a
valid UUID game route. Public routes, the lobby, lessons, settings, and
`/game/demo` do not load the Socket.IO browser library. This preserves a smaller
initial route bundle and prevents idle realtime work.

The browser never treats connection state as game state. PostgreSQL-backed HTTP
snapshots and protocol-v1 complete `game.snapshot` messages are authoritative.
The last validated snapshot remains visible and read-only while the transport
is uncertain.

## Ownership

| Concern                                     | Owner                                    | Persistence              |
| ------------------------------------------- | ---------------------------------------- | ------------------------ |
| Socket instance, listeners, heartbeat timer | `RealtimeClient` singleton               | Current tab/process only |
| Complete game snapshot                      | TanStack Query, `games.snapshot(gameId)` | Memory cache             |
| Connection status and safe issue metadata   | Transport Zustand store                  | Memory only              |
| Socket bearer token                         | Session storage adapter                  | Per-tab `sessionStorage` |
| Active-game safety hint                     | Session storage adapter                  | Per-tab `sessionStorage` |
| Route game ID                               | Next.js URL state                        | URL                      |

Tokens never enter React context values, TanStack Query data, Zustand, URLs,
telemetry counters, rendered errors, or logs.

## Connection lifecycle

1. The guest provider establishes a token-free ready session view.
2. A valid `/game/:uuid` route retrieves the token through the storage adapter.
3. `RealtimeClient.connect` dynamically imports `socket.io-client`, attaches
   one listener set, and opens one socket for the current guest identity.
4. A renewed token updates `socket.auth` without creating another socket.
5. `connect` starts one heartbeat interval. Disconnect stops it.
6. Reconnect attempts update a small transport store and keep the last snapshot
   visible.
7. A successful connection increments a connection epoch. The provider uses
   that epoch to request authoritative synchronization.
8. Leaving the real game route disconnects the socket and clears transport-only
   state.

The event-ID LRU retains at most 512 accepted IDs. Repeated event IDs increment
a duplicate counter and do not reach feature listeners.

## Validation and commands

- Every outbound command is constructed through the shared strict protocol-v1
  client envelope schema.
- Commands include UUIDv4 `eventId`, protocol version, type, and timestamp.
- Acknowledgements have an eight-second timeout and must pass the shared client
  acknowledgement schema.
- The acknowledgement `requestEventId` must match the command.
- Inbound event names must be supported and the parsed envelope type must match
  the actual Socket.IO event name.
- Invalid events and acknowledgements are rejected before feature state changes.
- Protocol errors retain safe code, retryability, correlation ID, and
  authoritative version without exposing credentials.

## Reconciliation order

Recovery is deliberately redundant because realtime connections can drop and
events can be missed:

1. On connection/reconnection, emit `game.sync` with the known active game and
   cached game version when available.
2. A complete `game.snapshot` acknowledgement replaces the Query snapshot.
3. If socket synchronization cannot confirm state, call
   `GET /v1/games/active`.
4. When active, call `GET /v1/games/:id/snapshot` and replace the cache.
5. `session.ready` is checked against the REST guest identity and an independent
   active-game lookup.
6. Identity disagreement fails closed and disconnects the socket.
7. Active-game disagreement follows the independent HTTP result and fetches its
   snapshot.
8. Incremental versioned events trigger snapshot recovery until the Phase 7
   version reducer owns event advancement.
9. Terminal snapshots clear the active-game hint and resume navigation.

Failure of the socket path never prevents the independent HTTP path from
running. Failure of both paths leaves any cached snapshot visible and presents
a bounded retry action.

## Route and privacy behavior

- `/game/demo` remains a fixture-only design demonstration.
- `/game/:uuid` is authenticated, fetches the authoritative snapshot, and may
  connect realtime.
- Invalid identifiers use the product not-found boundary and issue no snapshot
  request.
- `403`, `404`, `NOT_A_PLAYER`, and `GAME_NOT_FOUND` render the same
  privacy-safe state.
- The privacy-safe state contains no server error message, opponent name, board,
  clock, move, or game-status detail.
- When the current guest has a different active game, the UI may link only to
  that guest-owned game.

## Responsive and accessible UI contract

- The application header and desktop rail remain sticky navigation anchors.
- The reconnect banner is sticky on sufficiently wide/tall viewports.
- The recovery details panel is sticky beside the board on wide, tall
  viewports.
- When both are present, shared offsets and maximum heights keep them from
  overlapping.
- At widths below 1024 px the recovery panel returns to document flow.
- At widths below 768 px the reconnect banner returns to document flow.
- At viewport heights at or below 768 px both recovery sticky regions return to
  document flow.
- Move history is the only bounded scrolling region inside the recovery panel.
  It is keyboard-focusable, uses contained overscroll, and leaves the page
  scroll available.
- The board is read-only during Phase 4. An invalid FEN is never guessed or
  rendered.
- Connection state is expressed with text and icon, not color alone.
- Blocking failures use `role=alert`; connection progress uses `role=status`.
- Correlation IDs are displayed only when available and useful for support.

## Retry and telemetry policy

The realtime client relies on Socket.IO's bounded reconnect configuration and
does not add an independent reconnect loop. `game.sync` failure falls back once
to HTTP recovery. User actions can retry explicitly.

The transport store records only numeric counters:

- received events;
- duplicate events;
- invalid events;
- invalid acknowledgements;
- command timeouts;
- reconnect cycles.

No player, game, token, event payload, URL, or raw error is included.

## Implementation references

- [`../../frontend/src/services/realtime/realtime-client.ts`](../../frontend/src/services/realtime/realtime-client.ts)
- [`../../frontend/src/features/recovery/realtime-provider.tsx`](../../frontend/src/features/recovery/realtime-provider.tsx)
- [`../../frontend/src/features/recovery/game-recovery-screen.tsx`](../../frontend/src/features/recovery/game-recovery-screen.tsx)
- [`../../frontend/src/stores/transport-store.ts`](../../frontend/src/stores/transport-store.ts)
- [`../../frontend/test/e2e/phase-4.spec.ts`](../../frontend/test/e2e/phase-4.spec.ts)

The implementation follows the official Next.js guidance for dynamic imports
and navigation, Socket.IO guidance for reconnect handling and recovery
fallbacks, TanStack Query targeted invalidation guidance, and WCAG reflow/focus
requirements. The acceptance evidence is recorded in
[`phase-4-acceptance.md`](phase-4-acceptance.md).
