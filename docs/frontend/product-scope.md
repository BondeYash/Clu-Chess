# Frontend V1 Product Scope

> **Status:** Frozen for implementation
> **Date:** 2026-07-28
> **Contract:** [`../protocol-v1.md`](../protocol-v1.md)

## Product statement

CluChess is a server-authoritative anonymous realtime chess experience. It
should let a casual visitor reach a fair blitz game with very little setup,
remain understandable through connection problems, and recover the same active
game after a refresh.

The product is not a generic dashboard and has no clinician, administrator, or
account-management role in v1.

## Primary users

### First-time casual player

- May not understand chess notation or realtime connection states.
- Wants to start quickly without registering.
- Needs legal target hints, plain-language errors, and visible time control.

### Returning anonymous player

- Expects refresh/reconnect to keep the same unexpired identity and game.
- May use multiple tabs.
- Cannot recover the identity on another device by design.

### Keyboard or assistive-technology player

- Must be able to inspect and play the board without drag gestures.
- Needs a textual move representation and restrained announcements.

### Learning visitor

- May browse piece lessons without creating a guest or opening a socket.
- Needs accurate rules, diagrams, and keyboard-operable piece navigation.

## V1 capability map

| Capability                  | Anonymous visitor | Valid guest | Guest in queue |                Guest in active game |
| --------------------------- | ----------------: | ----------: | -------------: | ----------------------------------: |
| View public/learning pages  |               Yes |         Yes |            Yes |                                 Yes |
| Create a guest identity     |               Yes |          No |             No |                                  No |
| View/reset current identity |                No |         Yes |            Yes |       Yes, with abandonment warning |
| Join queue                  |                No |         Yes | Already joined |                                  No |
| Leave queue                 |                No |          No |            Yes |                                  No |
| View/recover own game       |                No |   If member |             No |                                 Yes |
| Submit a move               |                No |          No |             No | When allowed by authoritative state |
| Resign                      |                No |          No |             No |           In eligible active status |
| View another guest's game   |                No |          No |             No |                                  No |

Frontend capability checks explain state; the backend remains the authorization
boundary.

## Frozen screen inventory

### `/`

- Product promise and chess-specific identity.
- Primary “Play now” action.
- Short explanation of anonymous identity and recovery limits.
- Optional learning entry.
- No session creation until play is requested or a guest route is entered.

### `/play`

- Guest identity and connection state.
- Active-game resume banner when applicable.
- Fixed blitz match card.
- Joining, queued, leaving, rate-limited, unavailable, and matched states.
- Optional learning preview.
- No ratings, history, charts, or fake time-control selector.

### `/game/[gameId]`

- Opponent/self identity and clocks.
- Board, coordinates, move history, captured pieces, and game actions.
- Loading, waiting, live, pending move, syncing, reconnecting, terminal, and
  access-error states.
- Membership comes only from the backend snapshot/command result.

### `/learn`

- Six-piece lesson index.
- Static content; no guest or socket requirement.

### `/learn/[piece]`

- Piece navigation, hero, concise movement rules, example board, and pager.
- Known slugs: `king`, `queen`, `rook`, `bishop`, `knight`, `pawn`.

### `/settings`

- Guest identity summary.
- Local sound, coordinates, motion, and board-input preferences.
- Accessible explanation of per-device settings.
- Destructive “Start with a new identity” action.

### Supporting public pages

- `/privacy`
- `/terms`
- `/accessibility`

## Primary journeys

1. Public landing → guest bootstrap → lobby.
2. Lobby → queue → match → ready → live game.
3. Live game → confirmed moves → terminal result → lobby.
4. Refresh/deep link → session recovery → snapshot recovery.
5. Disconnect → reconnect grace → snapshot convergence.
6. Settings → identity reset → clean public state.
7. Public landing/guest shell → learning index → piece lesson.

Detailed sequences are in [`user-flows.md`](user-flows.md).

## V1 non-goals

- Editable identity.
- Email/password, OAuth, passkeys, or cross-device recovery.
- Ratings, leaderboards, game history, saved games, or analytics.
- More time controls or variants.
- Rematch, challenges, friends, chat, spectators, or tournaments.
- Admin/clinician workflows or permission management screens.
- Public game links.
- Offline move queueing.
- Client-adjudicated results or clock flags.
- User-selectable visual themes.

## Success measures

### Product

- A first-time visitor can reach the queue without form entry.
- The lobby never implies unsupported features.
- Every server lifecycle state has plain-language UI.

### Reliability

- Refresh or missed events converge through an authoritative snapshot.
- One proposed move becomes at most one confirmed visual move.
- Reset or identity change leaves no previous guest data in the client.

### Accessibility

- The complete play journey is keyboard operable.
- The board has a text-equivalent move representation.
- All critical states remain understandable without color, sound, or motion.

### Performance

- The landing page does not load Socket.IO or chess logic.
- The clock can tick without rerendering the board.
- Route-level bundle budgets in the master plan remain enforceable.

## Scope-change rule

A proposed UI requiring data or authority absent from protocol v1 must be logged
as a backend contract extension. It must not be implemented from placeholder or
fabricated data in the production path.
