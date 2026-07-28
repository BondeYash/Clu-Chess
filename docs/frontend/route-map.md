# Frontend Route and Navigation Map

> **Status:** Frozen for Phase 1 implementation
> **Related:** [`product-scope.md`](product-scope.md),
> [`adr/F0001-same-origin-production-topology.md`](adr/F0001-same-origin-production-topology.md)

## Route tree

```text
RootLayout
├─ (public) PublicLayout
│  ├─ /                         Landing
│  ├─ /learn                    Lesson index
│  ├─ /learn/[piece]            Piece lesson
│  ├─ /privacy                  Privacy
│  ├─ /terms                    Terms
│  └─ /accessibility            Accessibility statement
└─ (guest) GuestLayout
   ├─ /play                     Lobby and queue
   ├─ /game/[gameId]            Live/recovered/terminal game
   └─ /settings                 Preferences and identity reset
```

One root layout owns metadata defaults, fonts, global styles, providers, and
error fallbacks. Route groups organize layouts but do not appear in the URL.

## Route contract

| Route            | Access               | Content source                       | Client boundary              | Guard/recovery               |
| ---------------- | -------------------- | ------------------------------------ | ---------------------------- | ---------------------------- |
| `/`              | Public               | Compile-time product content         | Optional guest CTA state     | None                         |
| `/learn`         | Public               | Compile-time lesson catalog          | Piece-tab interaction only   | Feature flag                 |
| `/learn/[piece]` | Public               | Six validated lesson records         | Example board/tabs           | Unknown slug → 404           |
| `/privacy`       | Public               | Compile-time legal content           | None                         | None                         |
| `/terms`         | Public               | Compile-time legal content           | None                         | None                         |
| `/accessibility` | Public               | Compile-time statement               | Preference links only        | None                         |
| `/play`          | Guest bootstrap      | Session, active game, realtime queue | Session/realtime coordinator | Bootstrap; resume precedence |
| `/game/[gameId]` | Authenticated member | HTTP snapshot + Socket.IO            | Game client island           | UUID, membership, sync       |
| `/settings`      | Guest bootstrap      | Session + local preferences          | Form/reset coordinator       | Bootstrap                    |

Compile-time content is request-rendered inside the nonce-bearing server shell
while ADR F0007 applies.

## Nested layouts

### Public layout

- `header` landmark with brand, Play, Learn.
- `main` with skip target.
- contextual breadcrumbs on inner pages.
- restrained footer with privacy, terms, and accessibility.

### Guest layout

- guest session gate;
- application header with connection and identity;
- desktop rail or mobile bottom navigation outside live play;
- route error/loading boundaries;
- toast viewport for transient, noncritical feedback.

### Game focus mode

The game route uses the guest layout but changes its presentation:

- desktop navigation rail collapses;
- mobile general navigation is removed while a game is active;
- player/clock bars and board remain primary;
- move/actions panel becomes a drawer when space is constrained;
- navigation away during an active game does not resign or reset.

## Navigation ownership

| Item         | Public header | Desktop guest rail | Mobile guest nav | Live game |
| ------------ | ------------: | -----------------: | ---------------: | --------: |
| Brand/home   |           Yes |                Yes |               No |      Menu |
| Play/resume  |           Yes |                Yes |              Yes |        No |
| Learn        |           Yes |            Flagged |          Flagged |      Menu |
| Settings     |            No |                Yes |              Yes |      Menu |
| Game actions |            No |                 No |               No |       Yes |

All icon navigation has a visible text label outside the compact live-game
menu.

## Breadcrumbs

| Route            | Breadcrumb                               |
| ---------------- | ---------------------------------------- |
| `/learn`         | Home / Learn                             |
| `/learn/[piece]` | Home / Learn / Piece                     |
| `/settings`      | Play / Settings                          |
| `/privacy`       | Home / Privacy                           |
| `/terms`         | Home / Terms                             |
| `/accessibility` | Home / Accessibility                     |
| `/game/[id]`     | None; use game-specific focus navigation |

## Deep links

### Valid game member

1. Validate UUIDv4 locally.
2. Bootstrap/recover guest.
3. Fetch `GET /v1/games/:id/snapshot`.
4. Connect socket and sync.
5. Render the first non-regressing authoritative snapshot.

### Missing or expired identity

Do not create a new guest and then imply the game disappeared. Show:

> This game belongs to a previous anonymous session. CluChess cannot recover
> anonymous identities across expired sessions or devices.

Offer Home and Start a new game.

### Authenticated non-member or unknown game

Use one privacy-safe state:

> This game is not available to this guest session.

Do not render opponent identity, timestamps, result, or existence detail.

### Invalid game identifier

Render a local invalid-link state without calling the backend.

## Auth and redirect rules

- Guest routes show a stable bootstrap shell while identity resolves.
- Redirect to a known active game with `replace`, not `push`.
- After terminal result, returning to `/play` uses normal navigation.
- A `returnTo` target must be a parsed same-origin path from the frozen route
  allowlist.
- Proxy performs no backend authorization and no JWT decoding.
- Backend membership and command validation always win.

## Permission-aware navigation

- Active game changes Play to Resume game.
- `queue:join` is disabled with a reason when socket/session is not ready.
- `queue:leave` replaces Find match only after queue confirmation.
- Settings reset remains visible during a game but carries abandonment warning.
- Learn stays public and usable during backend outage.
- No role-specific navigation exists in v1.

## Loading/error boundaries

| Boundary        | Stable geometry                        | Recovery                         |
| --------------- | -------------------------------------- | -------------------------------- |
| Root            | Branded page frame                     | Reload/home                      |
| Guest bootstrap | App shell and identity skeleton        | Retry session                    |
| Lobby           | Match-card skeleton                    | Retry socket/action              |
| Game            | Two player bars + square board + panel | Sync/refetch/lobby               |
| Learning        | Text/hero skeleton                     | Retry/home                       |
| Settings        | Form group skeleton                    | Retry without losing local edits |
