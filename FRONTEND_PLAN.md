# CluChess Frontend Architecture and Implementation Plan

> **Status:** Phase 2 complete; Phase 3 ready to implement
> **Backend authority:** [`Architecture.md`](Architecture.md), [`docs/protocol-v1.md`](docs/protocol-v1.md), and the implemented controllers/gateway
> **Frontend scope:** Next.js App Router web client for anonymous identity, instant matchmaking, authoritative realtime chess, recovery, learning content, settings, and production operations
> **Delivery model:** A separately deployable `frontend/` application in this repository, integrated with the existing NestJS backend through REST and Socket.IO protocol v1
> **Product principle:** A quiet, premium chess-club experience—warm, tactile, and legible; no blue/purple neon, generic AI gradients, or ornamental effects that compete with the game

---

## 1. Outcome

Build a production-ready frontend in which:

- a first-time visitor receives a server-generated anonymous identity without completing a registration form;
- a returning visitor recovers the same unexpired guest session and active game;
- a guest can enter or leave the blitz queue and see an honest, accessible waiting state;
- a matched guest reaches the correct game by deep link, confirms readiness, and plays from the correct board orientation;
- proposed moves feel immediate but are never treated as authoritative until the server acknowledges them;
- duplicate events, ack timeouts, version gaps, browser refreshes, disconnects, and backend restarts converge on a complete server snapshot;
- clocks remain smooth and readable without pretending the browser clock is authoritative;
- terminal results, no-shows, resignations, timeouts, and abandonment have specific, humane UI states;
- keyboard, touch, pointer, screen-reader, reduced-motion, small-screen, and high-zoom users can complete the primary journey;
- the application is observable, testable, secure, deployable, and independently releasable.

The frontend must preserve the backend's central invariant: PostgreSQL and the server protocol decide identity, membership, colors, moves, clocks, game versions, and results. Client-side chess logic is a usability aid only.

### 1.1 Product truth from the current backend

The current product is an anonymous realtime chess application, not a clinician/admin product. The requirement to be easy for clinicians and non-technical users is interpreted as a general requirement for plain language, calm interaction, and low training cost. The frontend must not invent unsupported clinical, administrative, account, profile-editing, analytics, or game-history workflows.

Backend-supported v1 capabilities are:

- anonymous guest create, read, renew, and reset;
- one fixed `blitz` queue;
- one active game per guest;
- realtime readiness, moves, resignation, presence, heartbeats, and synchronization;
- HTTP active-game and snapshot recovery;
- server-generated names and one of eight knight avatar keys;
- one guest capability set with no roles or administrative permissions.

### 1.2 Explicit non-goals for v1

- Email/password, OAuth, passkeys, or cross-device account recovery.
- Editable display names or avatars.
- Multiple time controls, rated play, ratings, friends, chat, spectators, tournaments, or rematches.
- Game-history, leaderboard, analytics dashboard, collection search, table filtering, or pagination.
- Client-side adjudication of legal results or clock flags.
- Public exposure of `/metrics` or production readiness internals.
- Offline gameplay or a service worker that queues chess commands.
- A decorative 3D board for live play; live-game clarity wins over visual spectacle.

These are contract additions, not hidden frontend tasks. Their required backend gaps are recorded in §19.

---

## 2. Delivery principles

1. **Snapshots replace; events advance.** A complete `game.snapshot` replaces the local game model. Incremental events pass through one version-aware reducer.
2. **Tentative is visibly tentative.** A pending move may animate locally, but the authoritative FEN, move list, clocks, and version change only after a valid ack/event.
3. **Identifiers survive retries.** A retry of the same command reuses its original `eventId`, `clientMoveId`, correlation ID, and HTTP idempotency key.
4. **The server remains the permission boundary.** Route guards and capability checks improve UX; they do not grant access.
5. **Server state is not copied into a global UI store.** REST and game snapshots live in TanStack Query; Zustand contains small client-only coordination and preferences.
6. **URL state is shareable state.** Route identity, game ID, lesson piece, and settings subsections live in the URL when they should survive reload or deep linking.
7. **Every async surface has four states.** Loading, empty, failure, and success are designed alongside the happy path.
8. **Accessibility is a component contract.** Keyboard behavior, focus restoration, labels, live announcements, contrast, and reduced motion are part of acceptance—not a final audit.
9. **Animation explains change.** Framer Motion is limited to state transitions, dialogs/sheets, queue feedback, and optional piece motion.
10. **Performance work starts at component boundaries.** Server Components, client islands, route splitting, image/font ownership, and bundle budgets are designed before feature accumulation.
11. **Unknown server fields are tolerated; invalid known shapes are not.** Outbound v1 objects remain strict. Inbound parsing preserves forward-compatible unknown fields at the transport boundary and selects the supported v1 shape.
12. **No silent recovery loops.** Retries are bounded, visible when they affect the user, and finish with a clear retry or return-to-lobby action.

---

## 3. UI reference analysis and chosen design direction

The four supplied references show two related mobile surfaces: a live chess game and a piece-learning page, accompanied by a typography specimen.

### 3.1 What the references establish

| Reference observation                                | Interpretation                                                                          | Keep                                                  | Improve                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tall, rounded mobile cards floating on a pale canvas | The product should feel like a contained chess instrument, not a conventional dashboard | Strong silhouette and generous breathing room         | Use normal responsive shells rather than simulated device cards in the actual product                 |
| Charcoal/translucent game surfaces                   | Focus is concentrated around the board                                                  | Dark game rail and restrained material depth          | Remove low-contrast blur behind critical text; use opaque accessible surfaces                         |
| Large chess piece hero with classical serif title    | Chess heritage is part of the identity                                                  | Editorial serif for display moments                   | Restrict it to headings and lesson art; never use it for clocks, controls, or dense copy              |
| Neutral sans-serif for controls and body copy        | Gameplay must remain contemporary and readable                                          | Humanist sans for UI                                  | Increase body size, line height, and contrast                                                         |
| One bright cyan accent                               | Clear selection, legal-path, and active-nav affordance                                  | One disciplined accent role                           | Replace cyan with warm copper/brass so the product does not resemble a generic AI interface           |
| Board is the dominant object                         | Gameplay is the primary task                                                            | Board-first hierarchy                                 | Increase square size and touch targets; reduce decorative chrome                                      |
| Player identities and clocks sit above the board     | Both participants and time remain continuously visible                                  | Stable player/clock anchors                           | Improve clock prominence and state cues; do not encode urgency with color alone                       |
| Move history appears as small chips                  | Compact chronology                                                                      | Concise SAN history                                   | Use a readable paired move list with current-move focus and screen-reader announcements               |
| Bottom icon navigation                               | Mobile reachability matters                                                             | Thumb-accessible primary navigation outside live play | Add text labels; do not rely on ambiguous icons                                                       |
| Piece carousel/rail on the learning page             | Lessons should be browsable without a deep hierarchy                                    | Direct piece navigation                               | Add keyboard tabs, progress semantics, and responsive content order                                   |
| Soft blur, glow, and 3D pieces                       | The intended mood is polished and tactile                                               | Limited hero illustration depth                       | Avoid blur/glow on the live board; use optimized illustration only in static learning/marketing areas |
| Very small secondary copy and grey-on-grey text      | The concept prioritizes atmosphere over accessibility                                   | —                                                     | Meet WCAG 2.2 AA, support 200% zoom, and preserve a strong reading order                              |

### 3.2 Visual identity: “The Quiet Club”

The selected direction is a contemporary chess salon:

- warm parchment canvas;
- ink and charcoal game surfaces;
- oxidized copper as the action/focus accent;
- muted sage for board dark squares and calm status;
- brass for selected squares and earned emphasis;
- classical display typography paired with a high-legibility humanist sans;
- thin keylines, small material shadows, and almost no gradient;
- carved, flat-vector chess pieces for live play;
- richer rendered piece illustrations only for learning hero art.

It should feel more like a beautifully made board and editorial chess book than a gaming stream overlay, finance dashboard, or AI assistant.

### 3.3 Layout model

- **Public pages:** wide editorial grid with restrained header and content width.
- **Lobby:** focused action hub, not an analytics dashboard. Primary match card, identity, active-game recovery, and optional learning entry.
- **Live game:** board-first responsive workspace with fixed player/clock anchors and a contextual move/actions panel.
- **Learning:** piece hero, piece navigation rail, concise rules, interactive example board, and previous/next lesson actions.
- **Settings:** short grouped form for local preferences and a clearly separated destructive identity reset.

---

## 4. Core user journeys and frontend state model

### 4.1 Primary journey

```text
BOOTSTRAPPING
  ├─ valid guest, no active game ───────────────> LOBBY
  ├─ valid guest, active game ─────────────────> RECOVERING_GAME
  └─ no valid guest ─> CREATE_GUEST ───────────> LOBBY

LOBBY ── queue.join ack ──> QUEUED
QUEUED ── queue.leave ────> LOBBY
QUEUED ── match.found ────> MATCH_FOUND
MATCH_FOUND ── game.ready ─> WAITING_FOR_OPPONENT
WAITING_FOR_OPPONENT ──────> IN_PROGRESS
IN_PROGRESS <──────────────> RECONNECTING
IN_PROGRESS ───────────────> ENDED
RECONNECTING ──────────────> ENDED
ENDED ── return ───────────> LOBBY
```

This is a UI state model, not a second game-state authority. `GameStatus` from the backend remains canonical.

### 4.2 First visit

1. Render a fast branded bootstrap shell.
2. Check for a per-tab socket token in `sessionStorage`.
3. Call `GET /v1/session` using credentials and the token when present.
4. If the bearer attempt returns `401`, clear that token and retry `GET /v1/session` once with the HttpOnly cookie alone before concluding that the guest is invalid.
5. If no valid session exists, call `POST /v1/session` with a generated UUIDv4 `Idempotency-Key`.
6. Store the returned socket token in `sessionStorage`, never IndexedDB or application logs.
7. Connect Socket.IO with `auth.token`.
8. Reconcile `session.ready` and `GET /v1/games/active`.
9. Route to `/game/:id` when an active game exists; otherwise reveal the lobby.

### 4.3 Returning visit with cookie but no JavaScript token

The backend's HttpOnly cookie can authenticate REST but Socket.IO currently requires `auth.token`.

1. `GET /v1/session` confirms the cookie-backed session.
2. `POST /v1/session/renew` obtains a new in-memory/per-tab token using a stable pending idempotency key.
3. The client connects the socket and updates the renewal timer.

This avoids a long-lived `localStorage` token while remaining compatible with the existing backend. The frontend records this as a security decision because [`Architecture.md`](Architecture.md) currently describes a `localStorage` mirror.

### 4.4 Matchmaking

1. The lobby shows the fixed `5+2 blitz` control derived from match metadata/default product copy.
2. “Find a match” is enabled only when the session and socket are ready and no active game is known.
3. The ack changes the UI from `joining` to `queued`; repeated clicks cannot create duplicate commands.
4. The queue surface shows elapsed wait and advisory position only when supplied.
5. A queue intent marker is kept in `sessionStorage`. After an unexpected reconnect, the client may repeat `queue.join`; the implemented backend returns the existing queue state as `queue.joined`.
6. `match.found` clears queue intent, stores provisional match metadata, navigates to the dynamic game route, and sends `game.ready`.
7. A join-deadline countdown is explanatory only; the server decides no-show.

### 4.5 Move interaction

1. Select a piece by click/tap, keyboard, or pointer drag.
2. Derive legal target hints locally from the authoritative FEN using client-side `chess.js`.
3. For promotion, open an accessible four-piece chooser before submission.
4. Create one `eventId` and one `clientMoveId`.
5. Render the proposed move as a pending overlay and temporarily block another local move.
6. On `move.accepted`, pass the result through the version reducer and clear the overlay.
7. On a definitive rejection, restore the authoritative board and announce the reason.
8. On an ack timeout, retry with the same identifiers; if still uncertain, run `game.sync` before accepting more input.

### 4.6 Refresh and reconnect

- A deep link to `/game/:id` attempts authenticated HTTP snapshot recovery while the socket reconnects.
- The first complete snapshot wins and replaces local game state.
- `session.ready` with an active ID and `GET /games/active` are reconciled; disagreement triggers a fresh authoritative active-game read, not a guessed redirect.
- A non-member `403` shows a privacy-safe “This game is not available to this guest session” state.
- A version gap, parse failure, reconnect, visibility return, or uncertain mutation can request `game.sync`.

### 4.7 Session reset

- Label the action “Start with a new identity,” not “Log out.”
- Warn that the generated identity cannot be recovered.
- When an active game exists, state that reset immediately abandons it.
- On confirmation, reuse one reset idempotency key until a final outcome is known.
- After success: disconnect the socket, clear token/queue intent/pending commands/query cache, reset guest-scoped Zustand slices, and route to `/`.
- Create a new identity only when the user next chooses to play or explicitly chooses “Create new identity.”

---

## 5. UI/UX design system

### 5.1 Design tokens

Tokens live in `src/styles/tokens.css` and are exposed through Tailwind theme variables. Components consume semantic names, not raw palette values.

#### Color

| Semantic token    | Hex       | Use                                                          |
| ----------------- | --------- | ------------------------------------------------------------ |
| `canvas`          | `#F3F0E8` | Page background                                              |
| `canvas-strong`   | `#E7E0D2` | Secondary background and light board squares                 |
| `surface`         | `#FFFFFF` | Cards, menus, sheets                                         |
| `surface-inverse` | `#262B27` | Game rail and focused dark surfaces                          |
| `ink`             | `#1C211E` | Primary text                                                 |
| `ink-muted`       | `#5C625C` | Secondary text; 5.49:1 on canvas                             |
| `ink-inverse`     | `#F7F3EA` | Primary text on inverse surface                              |
| `line`            | `#D4CCBD` | Borders and dividers                                         |
| `accent`          | `#A65335` | Primary action, focus, selected state; white contrast 5.37:1 |
| `accent-strong`   | `#7B3D28` | Hover/pressed/error emphasis                                 |
| `sage`            | `#6D7763` | Dark board squares and neutral success                       |
| `brass`           | `#D7B46A` | Selected square, active lesson, premium highlight            |
| `danger`          | `#9A3F32` | Destructive controls and clock-critical state                |
| `success`         | `#4F6B50` | Connected/success state with label/icon                      |
| `focus-ring`      | `#A65335` | 2 px focus outline with 2 px canvas offset                   |

Rules:

- no blue/purple/neon tokens;
- no critical state expressed with color alone;
- translucent surfaces are decorative only and have an opaque fallback;
- board highlight combinations receive automated contrast and forced-colors tests;
- default light/dark system theming is not in v1—the deliberate parchment/charcoal composition is one tested theme;
- Windows forced-colors and browser high-contrast modes remain functional.

#### Typography

| Role    | Font                                                  | Use                                             |
| ------- | ----------------------------------------------------- | ----------------------------------------------- |
| Display | `Cormorant Garamond`, self-hosted through `next/font` | Hero headings, lesson piece names, result title |
| UI/body | `Manrope`, self-hosted through `next/font`            | Navigation, forms, copy, labels                 |
| Numeric | `Manrope` with `font-variant-numeric: tabular-nums`   | Clocks, queue duration, move numbers            |

The reference's Imperator-style small caps are reinterpreted rather than copied. Small caps are limited to short labels. Body text never uses display serif or all caps.

Type scale:

| Token        | Mobile / desktop | Line height | Use                            |
| ------------ | ---------------- | ----------- | ------------------------------ |
| `display-xl` | 48 / 72          | 0.95        | Marketing hero only            |
| `display-lg` | 40 / 56          | 1.0         | Lesson/result titles           |
| `heading-xl` | 30 / 40          | 1.15        | Page title                     |
| `heading-lg` | 24 / 30          | 1.2         | Section title                  |
| `heading-md` | 20 / 22          | 1.3         | Card title                     |
| `body-lg`    | 18 / 18          | 1.55        | Intro copy                     |
| `body`       | 16 / 16          | 1.55        | Default text                   |
| `body-sm`    | 14 / 14          | 1.45        | Supporting copy                |
| `label`      | 13 / 13          | 1.3         | Controls; never critical prose |
| `clock`      | 30 / 42          | 1.0         | Player clocks                  |

#### Spacing, shape, and elevation

- Base spacing unit: `4px`.
- Content spacing: 8, 12, 16, 24, 32, 48, 64, 96.
- Control minimum height: `44px`; primary touch controls target `48px`.
- Card radii: 16 and 24; buttons: 12; board frame: 18 desktop / 12 mobile.
- Avoid excessive pill shapes. Pills are reserved for status, SAN moves, and compact filters if future lists are introduced.
- Elevation:
  - `level-1`: border plus `0 1px 2px rgb(28 33 30 / 0.06)`;
  - `level-2`: `0 12px 32px rgb(28 33 30 / 0.10)`;
  - dialog: `0 24px 64px rgb(28 33 30 / 0.18)`.
- Game-critical panels use opaque backgrounds. `backdrop-filter` is optional decoration and never required for separation.

### 5.2 Motion

- Instant feedback: 100–140 ms.
- Control/state transition: 180–220 ms.
- Sheet/dialog/route context: 260–320 ms.
- Piece movement uses a short transform animation only after ack, or a distinct low-opacity pending animation before ack.
- Queue search uses a restrained orbit/board-rank indicator, not a looping glow.
- No parallax, background particles, animated gradients, or perpetual hero motion.
- `prefers-reduced-motion` removes nonessential movement and makes board changes immediate.
- Framer Motion is loaded through `LazyMotion` only in interactive feature chunks.

### 5.3 Iconography and imagery

- Use one outline icon family, normalized to 20/24 px and paired with text in navigation.
- Create a dedicated local mapping for the eight backend avatar keys:
  - `knight_amber_01`
  - `knight_bay_02`
  - `knight_bay_03`
  - `knight_black_01`
  - `knight_chestnut_01`
  - `knight_gray_02`
  - `knight_palomino_01`
  - `knight_white_02`
- Unknown avatar keys render a deterministic local knight fallback and report a nonfatal contract signal.
- Live pieces are optimized local SVGs with clear silhouettes at 32–96 px.
- Learning heroes may use WebP/AVIF rendered-piece art with explicit intrinsic dimensions, `next/image`, and documented license/provenance.

### 5.4 Core components and state contracts

Every reusable component ships with default, hover, focus-visible, disabled, loading, error, and forced-colors behavior where applicable.

- `Button`, `IconButton`, `LinkButton`
- `Card`, `InsetPanel`, `Divider`
- `Avatar`, `PlayerIdentity`
- `Badge`, `ConnectionBadge`, `StatusDot`
- `Dialog`, `AlertDialog`, `Drawer`, `Popover`, `Tooltip`
- `Toast` for transient noncritical feedback; critical state remains inline
- `Skeleton`, `Spinner`, `Progress`, `EmptyState`, `ErrorState`
- `Field`, `Switch`, `RadioGroup`, `Select`, `FormMessage`
- `Breadcrumbs`
- `AppHeader`, `DesktopRail`, `MobileNav`
- `Clock`, `QueueTimer`, `DeadlineNotice`
- `ChessBoard`, `ChessSquare`, `ChessPiece`, `PromotionDialog`
- `MoveList`, `CapturedPieces`, `GameActions`
- `OpponentPresence`, `ReconnectBanner`, `ResultSheet`
- `PieceLessonHero`, `PieceTabs`, `ExampleBoard`, `LessonPager`

### 5.5 Form design

The backend accepts no user-entered identity data, so v1 has no registration or profile form. React Hook Form and Zod are used where a form genuinely exists:

- local game/accessibility preferences;
- sound and board-interaction settings;
- identity-reset confirmation state.

Forms use:

- top-aligned labels;
- persistent helper/error text;
- inline validation on blur, then on change after the first error;
- a submit-level error summary for multi-field settings;
- no placeholder-only labels;
- disabled submission only for pending or structurally invalid state;
- focus to the first invalid field after submit.

### 5.6 Data presentation

- The lobby is an action hub, not a chart dashboard.
- Move history is a semantic ordered list. Desktop pairs white/black SAN under a move number; mobile uses compact rows.
- The current move has a text/shape marker as well as color.
- The list follows the newest move only when the user has not intentionally scrolled upward.
- At more than 200 plies, dynamically load row virtualization; normal games avoid virtualization complexity.
- There are no v1 collections needing pagination, filter, search, or sort. Those controls must not be scaffolded without an endpoint.

---

## 6. Frontend architecture

### 6.1 Runtime topology

```text
Browser
  ├─ Next.js pages/assets
  ├─ REST /v1/* ───────────────┐
  └─ Socket.IO /socket.io/* ───┤
                               v
                    Same-origin edge/router
                       ├─ Next.js frontend
                       └─ NestJS backend replicas
                              ├─ PostgreSQL
                              └─ Redis
```

Production should expose one HTTPS origin and route `/v1/*` and `/socket.io/*` to NestJS while routing other paths/assets to Next.js. This preserves the backend's secure SameSite cookie behavior, removes avoidable CORS complexity, and keeps WebSocket origin validation exact.

Local development:

- frontend: `http://localhost:5173`;
- backend: `http://localhost:3000`;
- backend already allows `http://localhost:5173`;
- frontend uses explicit public API/socket origins locally and relative same-origin URLs in production.

### 6.2 Repository decision

Add a standalone `frontend/` package rather than moving the existing backend into a new monorepo layout. This minimizes disruption to the completed backend, its Docker build, and its qualification evidence.

A transport-only `packages/protocol-v1/` package is the single exception. It contains Zod wire schemas/types with no NestJS, Prisma, Node-only, or browser-only imports. Both applications consume it through a pinned local package dependency.

The package exposes separate boundary schemas where compatibility rules differ:

- strict client-command and server-emission schemas for backend enforcement;
- tolerant client-receive schemas that validate all known v1 fields while stripping/ignoring unknown server fields;
- strict acknowledgement request identifiers and known error values.

This preserves the protocol rule that v1 clients ignore new optional server fields without weakening strict inbound validation on the backend.

If extracting the shared package would materially destabilize the backend build, Phase 1 may temporarily copy the schemas into the frontend, but CI must compare schema fixtures and this exception must have an owner/removal issue. Shared contracts remain the target architecture.

### 6.3 Rendering strategy

- Server Components by default for public copy, lesson content, metadata, legal pages, and layout chrome.
- Client Components only at browser boundaries:
  - session bootstrap;
  - TanStack Query provider;
  - Socket.IO connection;
  - board interaction;
  - clocks;
  - forms, dialogs, drawers, toasts;
  - persisted preferences.
- The live game is a focused client island inside a server-rendered route shell.
- Do not fetch fast-changing game state into the Next.js Data Cache.
- TanStack Query hydration is available for future cacheable reads; v1 authenticated session/game bootstrap happens in the client because socket token coordination is browser-specific.
- Route `loading.tsx` files preserve final layout dimensions and prevent board shift.
- Route `error.tsx` files present feature-specific recovery; root `global-error.tsx` is the last fallback.

### 6.4 REST layer

Choose a Fetch abstraction rather than Axios:

- works in Server and Client Components;
- uses platform `AbortSignal`;
- avoids a second request stack;
- keeps credentials/correlation/schema behavior centralized.

`apiFetch` responsibilities:

- resolve local versus same-origin base URL;
- add `Accept`, JSON `Content-Type` where needed, `X-Correlation-Id`, optional bearer token, and `Idempotency-Key`;
- use `credentials: 'include'`;
- enforce a bounded request timeout;
- parse JSON/text by content type;
- validate success and error payloads with Zod;
- convert failures into a typed `ApiError`;
- preserve HTTP status, public error code, retryability, retry delay, and correlation ID;
- never log tokens, cookies, request bodies containing credentials, or raw headers;
- perform no implicit retries.

Feature query/mutation hooks own retry and invalidation policy.

### 6.5 Realtime layer

`RealtimeClient` is a client-only service with one Socket.IO connection per browser tab.

Responsibilities:

- lazy-load `socket.io-client` after a valid guest token exists;
- prefer `websocket`, with polling fallback allowed for compatible proxies;
- configure connection-state recovery but never rely on it for correctness;
- parse every event/ack against protocol v1;
- emit strict envelopes with generated identifiers and timestamps;
- enforce one in-flight move per local game;
- apply ack timeout and bounded command retry policies;
- deduplicate event IDs with a bounded per-game LRU;
- publish typed transport state through a small external/Zustand store;
- update TanStack Query through a pure version-aware game reducer;
- start/stop application heartbeat based on socket state and page lifecycle;
- call sync on gaps or uncertain outcomes;
- expose test seams for fake clock, UUID source, socket adapter, and event injection.

It must not contain JSX, navigation decisions, toast copy, or chessboard rendering.

### 6.6 Authentication and token handling

- HttpOnly cookie remains the REST session anchor.
- Socket JWT is stored in `sessionStorage` per tab and in memory while active.
- No JWT in `localStorage`, IndexedDB, URL, analytics, crash reports, or React Query cache.
- Pending create/renew/reset idempotency keys are stored in `sessionStorage` until the operation reaches a known final state.
- Renew at approximately five minutes before `expiresAt`, with visibility/focus catch-up.
- A renewed token updates future Socket.IO handshakes; an existing socket does not need to be forcibly interrupted.
- A `401` during bootstrap attempts the defined create-new-guest path.
- A `401` during an active game is treated as identity loss: stop commands, preserve a safe visual snapshot, explain that the anonymous identity expired, and do not silently create a new guest inside that game.
- Proxy/route guards never decode a JWT to grant access.

### 6.7 Capability and permission layer

V1 has one authenticated principal type: `guest`. Define capabilities rather than a fictional role matrix:

```ts
type Capability =
  | "session:view"
  | "session:reset"
  | "queue:join"
  | "queue:leave"
  | "game:view"
  | "game:move"
  | "game:resign"
  | "learn:view";
```

`can(capability, context)` considers session state, socket state, active assignment, game membership/status, turn, and pending command state to enable or explain UI actions. It never replaces backend authorization.

Future roles can map to capabilities without rewriting navigation, but no v1 route or control pretends an admin/clinician role exists.

### 6.8 Feature flags

- Parse flags from environment with Zod at startup.
- Server-only flags remain server-only.
- Only flags intentionally exposed to the browser use `NEXT_PUBLIC_*`.
- Initial flags:
  - `learnHub`;
  - `soundEffects`;
  - `lessonHeroArt`;
  - `frontendTelemetry`.
- Flags are read through a typed `featureFlags` module, not `process.env` throughout components.
- A flag must have owner, default, expiry/removal condition, and tests for both states.
- No remote runtime flag service is added until a backend contract exists.

### 6.9 Error and loading boundaries

| Boundary            | Scope                              | Recovery                                              |
| ------------------- | ---------------------------------- | ----------------------------------------------------- |
| Root `global-error` | Rendering/runtime catastrophe      | Reload, return home, correlation reference if present |
| Public route error  | Marketing/lesson content           | Retry route, navigate home                            |
| Guest layout error  | Session/bootstrap/provider failure | Retry session bootstrap; never loop-create identities |
| Lobby error         | Matchmaking feature                | Reconnect or retry queue action                       |
| Game route error    | Snapshot/board feature             | Sync, refetch snapshot, return lobby                  |
| Component boundary  | Optional lesson art/move panel     | Hide optional feature without taking down board       |

Skeletons must mirror player row, board aspect ratio, and side-panel geometry. Spinners alone are not page layouts.

### 6.10 Environment configuration

Proposed frontend variables:

| Variable                       | Local                         | Production                             |
| ------------------------------ | ----------------------------- | -------------------------------------- |
| `NEXT_PUBLIC_APP_ORIGIN`       | `http://localhost:5173`       | exact HTTPS origin                     |
| `NEXT_PUBLIC_API_ORIGIN`       | `http://localhost:3000`       | empty/relative behind same-origin edge |
| `NEXT_PUBLIC_SOCKET_ORIGIN`    | `http://localhost:3000`       | empty/relative behind same-origin edge |
| `INTERNAL_API_ORIGIN`          | `http://app:3000` when needed | private backend service URL            |
| `NEXT_PUBLIC_PROTOCOL_VERSION` | `1`                           | `1`                                    |
| `NEXT_PUBLIC_FF_LEARN_HUB`     | `true`                        | release decision                       |
| `NEXT_PUBLIC_FF_SOUND_EFFECTS` | `true`                        | release decision                       |
| `NEXT_PUBLIC_FRONTEND_RELEASE` | build SHA                     | build SHA                              |
| `FRONTEND_TELEMETRY_DSN`       | absent/local                  | secret/server supplied                 |

The build fails on malformed origins, protocol mismatch, secret-like public variables, or production HTTP origins.

---

## 7. Component hierarchy

```text
RootLayout (Server Component)
├─ metadata, fonts, global styles
├─ Providers (Client boundary)
│  ├─ QueryClientProvider
│  ├─ PreferenceProvider / Zustand hydration
│  ├─ SessionCoordinator
│  ├─ RealtimeCoordinator
│  ├─ TooltipProvider
│  ├─ ToastViewport
│  └─ FrontendTelemetry
└─ Route group layout
   ├─ PublicLayout
   │  ├─ PublicHeader
   │  ├─ Breadcrumbs (inner pages)
   │  └─ PublicFooter
   └─ GuestLayout
      ├─ GuestSessionGate
      └─ AppShell
         ├─ AppHeader
         │  ├─ Brand
         │  ├─ ConnectionBadge
         │  └─ GuestMenu
         ├─ DesktopRail / MobileNav
         └─ Page outlet
            ├─ LobbyPage
            │  ├─ IdentityCard
            │  ├─ ActiveGameBanner
            │  ├─ MatchCard
            │  │  ├─ TimeControl
            │  │  ├─ FindMatchButton
            │  │  └─ QueuePanel
            │  └─ LearnPreview (flagged)
            ├─ GamePage
            │  └─ GameSessionBoundary
            │     ├─ OpponentBar
            │     │  ├─ PlayerIdentity
            │     │  └─ Clock
            │     ├─ BoardRegion
            │     │  ├─ ChessBoard
            │     │  │  ├─ CoordinateLabels
            │     │  │  └─ 64 ChessSquare buttons
            │     │  │     └─ ChessPiece
            │     │  ├─ PendingMoveLayer
            │     │  ├─ PromotionDialog
            │     │  └─ BoardAnnouncements
            │     ├─ SelfBar
            │     │  ├─ PlayerIdentity
            │     │  └─ Clock
            │     ├─ GameContextPanel
            │     │  ├─ StatusBanner
            │     │  ├─ MoveList
            │     │  ├─ CapturedPieces
            │     │  └─ GameActions
            │     ├─ ReconnectBanner
            │     └─ ResultSheet
            ├─ LearnIndexPage
            │  ├─ LessonGrid
            │  └─ LearningPrinciples
            ├─ PieceLessonPage
            │  ├─ PieceTabs
            │  ├─ PieceLessonHero
            │  ├─ LessonCopy
            │  ├─ ExampleBoard
            │  └─ LessonPager
            └─ SettingsPage
               ├─ PreferencesForm
               ├─ AccessibilitySettings
               └─ ResetIdentityCard
```

Rules:

- primitives do not import features;
- features may compose primitives and domain components;
- feature presentation components receive typed view models and callbacks;
- API/realtime code does not import React components;
- route files orchestrate features but contain little business logic;
- cross-feature imports go through each feature's public `index.ts`;
- circular feature imports fail lint/architecture tests.

---

## 8. Folder structure

```text
Cluchess/
├─ backend/
│  ├─ src/
│  ├─ prisma/
│  ├─ test/
│  ├─ scripts/
│  ├─ load-tests/
│  ├─ Dockerfile
│  ├─ package.json
│  └─ tsconfig.json
├─ packages/
│  └─ protocol-v1/
│     ├─ src/
│     │  ├─ http.ts
│     │  ├─ realtime.ts
│     │  ├─ enums.ts
│     │  └─ index.ts
│     ├─ test/
│     ├─ package.json
│     └─ tsconfig.json
├─ frontend/
│  ├─ public/
│  │  ├─ avatars/
│  │  ├─ chess-pieces/
│  │  ├─ lesson-art/
│  │  ├─ icons/
│  │  └─ manifest/
│  ├─ src/
│  │  ├─ app/
│  │  │  ├─ (public)/
│  │  │  │  ├─ page.tsx
│  │  │  │  ├─ learn/
│  │  │  │  │  ├─ page.tsx
│  │  │  │  │  └─ [piece]/page.tsx
│  │  │  │  ├─ privacy/page.tsx
│  │  │  │  ├─ terms/page.tsx
│  │  │  │  └─ accessibility/page.tsx
│  │  │  ├─ (guest)/
│  │  │  │  ├─ layout.tsx
│  │  │  │  ├─ play/page.tsx
│  │  │  │  ├─ game/[gameId]/page.tsx
│  │  │  │  └─ settings/page.tsx
│  │  │  ├─ layout.tsx
│  │  │  ├─ providers.tsx
│  │  │  ├─ loading.tsx
│  │  │  ├─ error.tsx
│  │  │  ├─ global-error.tsx
│  │  │  ├─ not-found.tsx
│  │  │  ├─ robots.ts
│  │  │  ├─ sitemap.ts
│  │  │  └─ manifest.ts
│  │  ├─ components/
│  │  │  ├─ ui/
│  │  │  ├─ navigation/
│  │  │  ├─ feedback/
│  │  │  └─ brand/
│  │  ├─ features/
│  │  │  ├─ session/
│  │  │  │  ├─ api/
│  │  │  │  ├─ components/
│  │  │  │  ├─ hooks/
│  │  │  │  ├─ model/
│  │  │  │  └─ index.ts
│  │  │  ├─ matchmaking/
│  │  │  ├─ game/
│  │  │  │  ├─ board/
│  │  │  │  ├─ clock/
│  │  │  │  ├─ components/
│  │  │  │  ├─ model/
│  │  │  │  ├─ realtime/
│  │  │  │  └─ index.ts
│  │  │  ├─ learning/
│  │  │  └─ settings/
│  │  ├─ lib/
│  │  │  ├─ api/
│  │  │  ├─ realtime/
│  │  │  ├─ query/
│  │  │  ├─ auth/
│  │  │  ├─ permissions/
│  │  │  ├─ observability/
│  │  │  ├─ environment/
│  │  │  ├─ feature-flags/
│  │  │  └─ utilities/
│  │  ├─ stores/
│  │  │  ├─ preferences.store.ts
│  │  │  └─ realtime.store.ts
│  │  ├─ styles/
│  │  │  ├─ globals.css
│  │  │  ├─ tokens.css
│  │  │  └─ board.css
│  │  ├─ content/
│  │  │  └─ lessons/
│  │  ├─ test/
│  │  │  ├─ fixtures/
│  │  │  ├─ factories/
│  │  │  ├─ msw/
│  │  │  └─ setup.ts
│  │  └─ proxy.ts
│  ├─ e2e/
│  ├─ stories/
│  ├─ Dockerfile
│  ├─ next.config.ts
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ vitest.config.ts
│  ├─ playwright.config.ts
│  └─ .env.example
├─ docs/
├─ compose.yaml
├─ compose.multi.yaml
├─ Architecture.md
├─ FRONTEND_PLAN.md
└─ README.md
```

File naming:

- components: `PascalCase.tsx`;
- hooks: `use-*.ts`;
- stores/services/schemas: `kebab-case.ts`;
- tests colocated for units and under `e2e/` for journeys;
- no generic `helpers.ts` or `utils.ts` dumping ground.

---

## 9. Routing and navigation map

### 9.1 Routes

| URL              | Group          | Access                   | Rendering                                         | Purpose                                                | Failure behavior                               |
| ---------------- | -------------- | ------------------------ | ------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `/`              | public         | Anyone                   | Server-first; compile-time content                | Brand, product explanation, “Play now,” learning entry | Public error boundary                          |
| `/learn`         | public         | Anyone                   | Server; compile-time content                      | Piece lesson index                                     | Feature flag may hide nav and return not found |
| `/learn/[piece]` | public dynamic | Anyone                   | Six known content variants rendered by the server | King/queen/rook/bishop/knight/pawn lesson              | Unknown slug → 404                             |
| `/privacy`       | public         | Anyone                   | Server; compile-time content                      | Privacy and anonymous-session explanation              | Public error boundary                          |
| `/terms`         | public         | Anyone                   | Server; compile-time content                      | Terms                                                  | Public error boundary                          |
| `/accessibility` | public         | Anyone                   | Server; compile-time content                      | Accessibility statement and controls guide             | Public error boundary                          |
| `/play`          | guest          | Guest bootstrap required | Server shell + client gate                        | Lobby and matchmaking                                  | Retry session/socket, do not loop redirect     |
| `/game/[gameId]` | guest dynamic  | Authenticated member     | Server shell + client recovery                    | Live or terminal game                                  | 400/403/404-specific state                     |
| `/settings`      | guest          | Guest bootstrap required | Server shell + client form                        | Preferences and identity reset                         | Preserve unsaved local form state on retry     |

### 9.2 Layouts

- One root layout owns fonts, metadata defaults, providers, security headers, and global styles.
- `(public)` owns editorial header/footer.
- `(guest)` owns session gate and application shell.
- Game route switches the shell into focus mode:
  - desktop rail collapses;
  - mobile bottom nav is replaced by board/game actions;
  - critical player clocks remain sticky within safe-area insets.
- Route groups do not appear in URLs.

### 9.3 Navigation

Desktop rail:

- Play;
- Learn (flagged);
- Settings.

Mobile bottom navigation outside live play:

- Play;
- Learn;
- Settings.

Top bar:

- brand/home;
- current connection state;
- guest avatar/name menu;
- “Resume game” takes precedence over “Find match.”

Navigation is capability-aware:

- active game changes Play label/action to Resume;
- queue state keeps the user in lobby and marks Play as active;
- session bootstrap disables mutation links but leaves public Learn usable;
- no control is hidden when showing it disabled with a reason better teaches system state.

### 9.4 Breadcrumbs

- Use on Learn → Piece, Settings, Privacy, Terms, and Accessibility.
- Do not show a conventional breadcrumb inside the live board; provide an accessible “Back to lobby” action after game end.
- Dynamic game metadata never includes opponent identity in document title or Open Graph output.

### 9.5 Deep-link behavior

- Validate `gameId` as UUIDv4 before any request.
- Valid session + membership: recover and render.
- Valid session + non-membership: show private unavailable state.
- Expired/missing session: explain that anonymous game access belongs to the original guest; do not reveal whether the game exists.
- Terminal game: render snapshot result; recovered PGN is unavailable under v1 unless retained in the current tab.

### 9.6 Route guards

- The `(guest)` client gate coordinates session creation/recovery.
- `proxy.ts` sets security/correlation headers and never performs slow backend authorization.
- The game route always lets the backend membership check decide access.
- Auth redirects use `replace` to avoid back-button loops.
- Preserve a safe `returnTo` only for same-origin allowlisted routes; never reflect arbitrary URLs.

---

## 10. API integration matrix

### 10.1 Query key factory

```ts
queryKeys.session.current();
queryKeys.game.active();
queryKeys.game.snapshot(gameId);
queryKeys.learning.lesson(piece);
```

Guest-scoped caches are cleared on reset or identity change. Keys never contain JWTs.

### 10.2 HTTP endpoints

| Endpoint                     | Consumer and timing                                                                               | Cache/refetch                                                                                                               | Loading and error UX                                                                                                 | Retry/mutation/invalidation                                                                                                                                                    | Pagination/filter/search/sort                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `POST /v1/session`           | Guest gate when `GET session` proves no valid session; explicit create after reset                | Not cached as a mutation; seed the session view, then fetch `GET session` in the background because create omits `issuedAt` | Branded bootstrap skeleton; 429 shows wait time; 503 offers bounded retry                                            | Generate/persist one idempotency key; retry network/503 at most twice with same key; update session cache and token; then invalidate active game                               | Not applicable                                |
| `POST /v1/session/renew`     | Five minutes before expiry; cookie-valid/token-missing bootstrap; auth recovery where safe        | Not cached; update session expiry and per-tab token                                                                         | Nonblocking renewal indicator only if gameplay unaffected; blocking message only when token cannot be recovered      | Same pending key across retries; retry network/503/eligible 429 at most twice; no retry for 400/401/409; update socket auth for next reconnect                                 | Not applicable                                |
| `GET /v1/session`            | Guest bootstrap, focus/reconnect validation, settings identity card                               | `staleTime: 5 min`, `gcTime: 15 min`; refetch on reconnect; focus only when stale                                           | Identity skeleton; 401 branches to defined bootstrap, 503 shows service unavailable                                  | Retry network/503 twice with jitter; never retry 401/400; identity change clears every guest-scoped cache/store                                                                | Not applicable                                |
| `POST /v1/session/reset`     | Settings destructive confirmation                                                                 | Not cached                                                                                                                  | Button pending state; failure remains inline with correlation reference; active-game consequence shown before submit | Same idempotency key until final; retry network/503 once automatically, otherwise explicit retry with same key; on success clear all caches/stores/token and disconnect socket | Not applicable                                |
| `GET /v1/games/active`       | After session success, socket reconnect, uncertain `ALREADY_IN_GAME`, and stale focus return      | `staleTime: 5 s`, `gcTime: 5 min`; refetch on reconnect/focus; no interval                                                  | Small resume-card skeleton; failure does not erase known active game                                                 | Retry network/503 twice; reconcile result with `session.ready`; non-null result preloads snapshot route                                                                        | Not applicable                                |
| `GET /v1/games/:id/snapshot` | Direct game route, socket unavailable, reconnect, version gap fallback, uncertain command outcome | `staleTime: 0` during live game; `gcTime: 10 min`; socket events update same cache; focus/reconnect refetch as needed       | Board-shaped skeleton; 400 invalid link, 403 private unavailable, 404 ended/unavailable, 503 retry panel             | Retry network/503 twice; full success replaces game cache; no optimistic mutation; do not retry 400/401/403/404                                                                | Not applicable; response is one full snapshot |
| `GET /healthz`               | Infrastructure only                                                                               | No browser query                                                                                                            | No end-user UI                                                                                                       | Deployment health probe only                                                                                                                                                   | Not applicable                                |
| `GET /readyz`                | Infrastructure/status tooling only                                                                | No browser query                                                                                                            | Generic service state is derived from actual request/socket failures, not exposed dependency details                 | Load-balancer readiness only                                                                                                                                                   | Not applicable                                |
| `GET /metrics`               | Internal Prometheus only                                                                          | Never requested by frontend                                                                                                 | Must be unreachable from public UI                                                                                   | No frontend integration                                                                                                                                                        | Not applicable                                |

HTTP list mechanics are intentionally absent. The backend exposes no list endpoint, so pagination, filtering, searching, and sorting are “not applicable,” not deferred frontend TODOs.

### 10.3 Client-to-server Socket.IO commands

| Command          | UI trigger                                                               | Pending/optimistic behavior                                                          | Ack timeout and retry                                              | Success/cache effect                                                                           | Error effect                                                          |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `queue.join`     | Find match                                                               | Button → joining; do not claim queued before ack                                     | 4 s; retry twice with same `eventId`                               | Store queue state/intent and render queue panel                                                | `ALREADY_IN_GAME` → active-game recovery; rate/503 → inline retry     |
| `queue.leave`    | Cancel search                                                            | Queue panel → leaving; keep elapsed state until ack/event                            | 4 s; retry twice with same `eventId`                               | Clear queue state/intent                                                                       | Restore queued state and show retry                                   |
| `game.ready`     | Match route mounted after `match.found` or recovery needs room readiness | Waiting surface; idempotent repeat allowed                                           | 4 s; retry twice, then sync                                        | Ack snapshot replaces game cache; started event advances status                                | Stale → sync; not-member/not-found → route error                      |
| `move.submit`    | Board move/promotion                                                     | Pending piece overlay; authoritative cache unchanged; board blocks second local move | 3 s; retry twice with same `eventId` and `clientMoveId`; then sync | Reducer applies ack once by version/ply; invalidate no query because cache is directly updated | Roll back overlay; code-specific announcement; stale/uncertain → sync |
| `game.resign`    | Confirmed resign dialog                                                  | Dialog pending; game remains visually live until ack                                 | 4 s; retry twice with same durable `eventId`; then sync            | Apply `game.ended`, clear active game after authoritative terminal state                       | Ended/stale → sync; service failure leaves explicit retry             |
| `game.sync`      | Gap, reconnect, visibility recovery, user retry                          | Show subtle syncing banner; keep last safe board read-only                           | 5 s; one retry, then HTTP snapshot fallback                        | Complete snapshot replaces cache; `session.ready` with no active game returns lobby state      | Preserve last snapshot and show reconnect/refetch controls            |
| `heartbeat.ping` | Scheduled while connected and on resume                                  | No visible pending state                                                             | No immediate retry; next scheduled tick                            | Update server offset, last pong, and presence lease metadata                                   | Repeated miss changes connection badge and prompts reconnect          |

### 10.4 Server-to-client events

| Event                 | Frontend handling                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.ready`       | Validate, update guest and active-game caches, resolve bootstrap; do not overwrite a newer known identity                                  |
| `queue.joined`        | Set queue state, preserve original `since`, display advisory position                                                                      |
| `queue.left`          | Clear queue intent; `matched` expects `match.found`, other reasons explain why search stopped                                              |
| `match.found`         | Clear queue, persist provisional metadata, navigate to game route, announce color/opponent/time control, send ready                        |
| `game.snapshot`       | Always replace authoritative game cache after membership/ID match; clear resolved pending move                                             |
| `game.started`        | Advance status/initial position/clocks through reducer; announce game start                                                                |
| `move.accepted`       | Deduplicate by event/ply, apply FEN/move/turn/clocks/version, animate confirmed move, announce SAN/check                                   |
| `move.rejected`       | Targeted pending-command resolution; never expose it to opponent UI; sync where required                                                   |
| `player.disconnected` | Update presence overlay/status through reducer, show grace countdown with “clocks continue”                                                |
| `player.reconnected`  | Clear relevant disconnect notice; expect/reconcile snapshot                                                                                |
| `game.ended`          | Apply final FEN/clocks/result/termination; store PGN only in bounded per-tab result state; clear active query after result is safely shown |
| `heartbeat.pong`      | Estimate server time offset from RTT sample; refresh transport health                                                                      |
| `server.error`        | Map to inline/global recovery based on game context; retry only when marked retryable                                                      |

### 10.5 Cache invalidation rules

- `session create/renew` → set session cache, invalidate active game.
- `session reset` → remove all guest-scoped queries, not merely invalidate.
- `match.found` → set active game ID and seed provisional metadata; snapshot remains loading.
- `game.snapshot` → set snapshot exactly and active ID when nonterminal.
- `move.accepted`, presence, start → update snapshot with reducer; no network invalidation on every event.
- `game.ended` → update terminal snapshot, set active ID to `null`, retain terminal game cache for the current route.
- version gap, schema mismatch, uncertain command → `game.sync`; HTTP snapshot is fallback.
- focus/reconnect → active-game check plus snapshot refetch/sync when the cached live game is older than the last transport loss.
- identity ID change → synchronously clear all previous guest data before rendering the new identity.

### 10.6 Retry classification

Never retry automatically:

- `INVALID_PAYLOAD`;
- `UNSUPPORTED_PROTOCOL_VERSION`;
- `UNSUPPORTED_EVENT`;
- `IDEMPOTENCY_KEY_REUSED`;
- `GAME_NOT_FOUND`;
- `NOT_A_PLAYER`;
- `ILLEGAL_MOVE`;
- definitive `UNAUTHORIZED`.

Retry or recover as directed:

- `STALE_GAME_VERSION` → sync, never blindly resubmit against the new version;
- `NOT_YOUR_TURN` → clear pending and wait for authoritative state;
- `ALREADY_QUEUED` → treat as current queued state and preserve the original queue time;
- `ALREADY_IN_GAME` → active-game lookup/sync;
- `GAME_ALREADY_ENDED` and `CLOCK_EXPIRED` → sync terminal result;
- `RATE_LIMITED` → honor `retryAfterMs`, disable action with countdown;
- `SERVICE_UNAVAILABLE`/`INTERNAL_ERROR` → bounded jittered retry using the same identifiers, then explicit user recovery.

---

## 11. Realtime consistency algorithm

### 11.1 Game cache shape

Keep transport metadata separate from the backend snapshot:

```ts
interface CachedGame {
  gameId: string;
  version: number;
  snapshot: GameSnapshotPayload;
  lastEventAt: number;
  lastConfirmedPly: number;
}
```

Pending UI:

```ts
interface PendingMove {
  eventId: string;
  clientMoveId: string;
  expectedVersion: number;
  from: Square;
  to: Square;
  promotion?: Promotion;
  attempts: number;
  state: "sending" | "uncertain";
}
```

### 11.2 Reducer rules

1. Parse the event.
2. Reject/telemetry-report a game ID mismatch.
3. Ignore a previously seen `eventId`.
4. A full snapshot replaces local state regardless of whether its move count equals version, unless its version is lower than a higher version already applied while that snapshot request was in flight. In that response race, discard it and sync again rather than regress.
5. For incremental events:
   - version below local → stale; ignore;
   - version equal local → allow documented companion/idempotent semantics, dedupe moves by `ply`;
   - version exactly local + 1 → apply;
   - version greater than local + 1 → mark gap and sync before applying.
6. `move.accepted` color is derived from the previous authoritative turn; if that context is unavailable, sync instead of guessing.
7. Never infer terminal result from client chess logic.
8. Every reducer operation is pure and table-tested across event order permutations.

Ack and broadcast may describe the same move with different event IDs. Move deduplication therefore also uses `ply` plus authoritative version, not event ID alone.

### 11.3 Clock model

- Store server-reported base clocks and `serverTime`.
- Estimate offset using heartbeat round trip; retain a small median sample window to reduce jitter.
- Display the running side as:

```text
displayed = baseRemaining - max(0, estimatedServerNow - baseServerTime)
```

- Clamp at zero visually, but do not declare the winner.
- Isolate ticking inside `Clock`; do not rerender the board on each tick.
- Update visible clocks at 100 ms below 10 seconds and 250 ms otherwise.
- On hidden tabs, stop animation work; calculate current display immediately on resume and sync if transport was interrupted.
- Use tabular numerals and a text/icon urgency cue at 30 and 10 seconds.

### 11.4 Multi-tab behavior

- Each tab has its own socket and `sessionStorage` token.
- The backend treats the guest as connected until the final tab disconnects.
- Use `BroadcastChannel` only for optional local preference and “another tab is active” hints, never for game authority.
- A move accepted in one tab reaches the other via server broadcast.
- A pending move in one tab encountering a version event from another tab becomes uncertain and syncs.

---

## 12. State management strategy

| State                    | Owner                              | Examples                                                               | Persistence                                                    |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Server state             | TanStack Query                     | guest, active game ID, authoritative snapshot                          | Memory only; refetched/recovered                               |
| Realtime transport state | Small Zustand store/external store | disconnected/connecting/connected/recovering, last pong, server offset | Memory only                                                    |
| Queue coordination       | Zustand matchmaking slice          | joining/queued/leaving, since, advisory position                       | Queue intent only in `sessionStorage`                          |
| Pending command state    | Feature reducer/store              | pending move, resign attempt, sync reason                              | Necessary identifiers in `sessionStorage` only while uncertain |
| Local component state    | React state/reducer                | selected square, promotion dialog, open drawer, hover target           | None                                                           |
| URL state                | App Router params/search params    | game ID, lesson piece, settings subsection                             | Browser history/deep link                                      |
| Session credential state | Session coordinator                | socket JWT, expiry, idempotency keys                                   | JWT/idempotency keys in `sessionStorage`; cookie HttpOnly      |
| User preferences         | Zustand persist                    | sound, coordinate labels, motion override, board input mode            | `localStorage`, schema-versioned; no identity/token            |
| Static content           | Server Components/local content    | lesson copy, legal text, avatar map                                    | Build output/CDN                                               |
| Feature flags            | Typed environment module           | learn/sound/art/telemetry                                              | Build/deploy configuration                                     |

Avoid:

- Redux-style copies of Query data;
- storing a whole game in Zustand;
- persisting Query cache with guest/game data;
- placing queue/game truth in URL query strings;
- using Context for high-frequency clock ticks.

---

## 13. Responsive behavior

### 13.1 Breakpoint intent

Use mobile-first viewport breakpoints plus container queries for the game workspace.

| Context              | Layout                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| 320–479 px portrait  | Full-width board, compact player bars, actions/moves in bottom drawer, safe-area bottom padding           |
| 480–767 px portrait  | Board up to available width, move preview below, labeled mobile nav outside game                          |
| 568–932 px landscape | Board limited by viewport height, clocks beside identities, collapsible context rail                      |
| 768–1199 px tablet   | Board + 280 px context panel when space permits                                                           |
| 1200+ px desktop     | Collapsed nav rail + centered board + 320–360 px context panel                                            |
| 200% zoom            | Single-column flow, no clipped board/actions, horizontal overflow only inside move history if unavoidable |

### 13.2 Board sizing

- Use `min(available inline size, available block size after player bars)`.
- Preserve square aspect ratio with CSS grid/aspect ratio.
- Never hide ranks/files solely to gain space; users may turn coordinates off in settings.
- Drag targets follow the full square; pointer capture cancels safely outside board.
- Bottom drawers do not cover the player's clock or active promotion dialog.

### 13.3 Navigation adaptation

- Desktop rail at wide containers.
- Labeled bottom navigation on mobile outside live play.
- Focus game mode replaces general navigation with game-specific controls and a menu.
- All navigation remains reachable by keyboard and landmark.

---

## 14. Accessibility requirements

Target WCAG 2.2 AA.

### 14.1 Chessboard

- Board is a labeled grid with 64 focusable square semantics managed by roving tabindex.
- Arrow keys move focus; Home/End and modifier shortcuts move by rank/file.
- Enter/Space selects and confirms; Escape cancels selection/drag/promotion.
- Square label includes coordinate, occupying piece/color, selected/check/legal-target state.
- Legal targets use shape plus text announcement, not color alone.
- Orientation changes visual order while accessible coordinates remain correct.
- Moves are announced through a polite live region; check, game start, disconnect, and result have appropriate priority.
- A text move list is always available as an equivalent representation.

### 14.2 General interaction

- Visible focus on every interactive element.
- Focus trapped and restored for dialogs/sheets.
- Minimum 44 × 44 px targets.
- Skip links to main content, board, and move history.
- Landmarks and one logical `h1`.
- Status messages use `role=status`; destructive or blocking failures use `role=alert` sparingly.
- Reduced motion and forced colors are tested, not just declared.
- Sound is off until user-enabled and never the sole cue.
- Clock urgency includes a label and change in shape/weight.
- Time updates are not announced continuously; only thresholds are announced.

### 14.3 Content

- Plain-language result/termination copy.
- No unexplained backend codes in the UI.
- Reading level appropriate to casual chess players.
- Lesson diagrams have text equivalents.
- Decorative chess art has empty alt text; meaningful avatar/piece art has concise labels.

---

## 15. Performance plan

### 15.1 Loading and code splitting

- App Router provides route-level splitting.
- Lazy-load `socket.io-client` after session bootstrap.
- Load `chess.js`, board interaction, Framer Motion, sound, and move virtualization only on relevant routes/states.
- When queue join succeeds, warm the game feature chunks with a controlled dynamic import.
- Keep public landing and legal content free of realtime/game dependencies.
- Render providers as deep as practical; public static content should not subscribe to guest/game stores.

### 15.2 Data performance

- TanStack Query deduplicates concurrent session/snapshot reads.
- Do not poll snapshots during a healthy socket connection.
- Reconcile on focus/reconnect/gap rather than background intervals.
- Abort superseded route and bootstrap requests.
- Apply incremental events to cache to avoid a fetch per move.
- Keep bounded event-ID and clock-offset buffers.
- Virtualize move rows only above the measured threshold.

### 15.3 Asset performance

- `next/image` for avatars and lesson art with correct `sizes`.
- SVG pieces loaded as a single optimized sprite/module, not 32 network requests.
- `next/font` self-hosts only required subsets/weights.
- Preload only the UI regular/medium font and critical piece sprite.
- AVIF/WebP for raster hero art; no autoplay video.
- Long immutable caching for fingerprinted assets.

### 15.4 Rendering performance

- Clock ticking is isolated from board and move list.
- Memoize expensive FEN-to-view-model and legal-target calculation by authoritative FEN/selection.
- Do not blanket-apply `memo`; profile before keeping it.
- Use CSS transforms for piece movement and compositor-safe drawer motion.
- Reserve board, avatar, and illustration dimensions to prevent CLS.
- Use Suspense around optional lesson art/context panels, never around a move already visible.

### 15.5 Budgets

Release budgets, verified in production build:

- public landing first-load JS: target ≤ 120 KiB gzip;
- lobby first-load JS: target ≤ 180 KiB gzip;
- game route first-load JS: target ≤ 250 KiB gzip;
- no single unapproved client chunk > 100 KiB gzip;
- LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 field target;
- board input feedback ≤ 100 ms before pending visual state;
- route/game recovery UI visible ≤ 1 s on a normal warm connection;
- no more than one active socket and one heartbeat timer per tab.

Bundle analyzer output and Lighthouse traces are retained as release artifacts.

### 15.6 Streaming and incremental rendering

- Stream public/lesson shells and lower-priority content where the deployment benefits.
- The game shell streams immediately; authenticated game state hydrates inside a stable skeleton.
- Do not use Next Data Cache or ISR for live guest/game state.
- Lesson data and media manifests are compiled at build time. While nonce-based CSP is enforced, HTML is request-rendered; static HTML generation may be enabled only after a stable, nonexperimental strict-CSP strategy is validated.
- Incremental rendering means isolated clock/event updates, not speculative client game truth.

---

## 16. Security, privacy, and observability

### 16.1 Browser security

- Enforce HTTPS/WSS in production.
- Same-origin edge for frontend, REST, and Socket.IO.
- Strict origin allowlist remains on backend.
- Nonce-based CSP through current Next.js `proxy.ts`; roll out report-only first, then enforce.
- CSP minimum: self-only defaults, explicit `connect-src` for socket/API/telemetry, no object/frame embedding, restricted images/fonts, and production without `unsafe-eval`.
- Security headers: HSTS at edge, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, and `frame-ancestors 'none'`.
- No `dangerouslySetInnerHTML` for lesson content; compile trusted local content or render typed content blocks.
- Dependency, license, secret, and container scans parallel backend gates.
- No open redirects from `returnTo`.
- Public source maps upload privately to error tooling, not public hosting.

Nonce CSP makes affected routes dynamic. This is an accepted security/performance tradeoff for the play application; measure server/render cost rather than weakening token protection silently.

### 16.2 Privacy

- No analytics identity built from guest ID.
- Hash or redact guest/game identifiers before telemetry where exact IDs are unnecessary.
- Never capture JWT, cookie, authorization, raw socket auth, full request headers, or local storage.
- Avoid session replay tooling on the game board by default.
- Document local preference and per-tab credential storage.
- Reset clears all guest-scoped browser data.

### 16.3 Frontend telemetry

Technical events:

- session bootstrap duration/outcome;
- socket connect/reconnect duration and reason;
- queue join ack and search duration;
- match-to-ready duration;
- move ack latency/outcome;
- version gap and sync reason/outcome;
- snapshot recovery latency;
- clock offset quality;
- route error boundary activation;
- Web Vitals and bundle release identifier.

Every request/command carries a correlation ID. UI error references show only the correlation ID, never stack details.

Suggested counters/histograms:

- `frontend_session_bootstrap_ms`;
- `frontend_socket_connect_ms`;
- `frontend_queue_wait_ms`;
- `frontend_move_ack_ms`;
- `frontend_sync_total{reason,outcome}`;
- `frontend_protocol_parse_failures_total{event}`;
- `frontend_error_boundary_total{route}`;
- standard Web Vitals.

Alert on sustained protocol parse failures, connection failures, sync storms, and client release-specific error regressions—not individual user mistakes such as illegal moves.

---

## 17. Testing strategy

### 17.1 Tooling

- Vitest for unit and integration tests.
- React Testing Library and `@testing-library/user-event` for behavior.
- MSW for HTTP boundary tests.
- A typed fake Socket.IO adapter/event harness for deterministic component/integration tests.
- Playwright for two-browser-context end-to-end tests.
- `axe-core`/Playwright accessibility automation.
- Storybook for primitive/game-state catalog and visual review.
- Lighthouse CI and bundle analyzer for performance.
- Optional `fast-check` for reducer/event-order properties after the core table suite exists.

### 17.2 Test layers

| Layer               | Scope                                        | Required examples                                                                                              |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit                | Pure helpers/models                          | clocks, version reducer, error mapping, FEN view model, capabilities, environment parsing, storage migrations  |
| Component           | One component/state                          | button states, player bar, clock thresholds, board keyboard model, promotion dialog, result sheet, queue panel |
| Feature integration | Hooks + cache + fake transport               | session bootstrap, queue ack, match navigation, move ack/broadcast dedupe, version-gap sync, reset cleanup     |
| Contract            | Shared Zod package + fixtures                | Every HTTP success/error, 7 C→S commands, 13 S→C events, ack variants, forward-compatible server fields        |
| E2E                 | Real frontend + backend + PostgreSQL + Redis | Two guests create, match, ready, play, reconnect, resign/finish                                                |
| Accessibility       | Automated + manual                           | Board keyboard/screen reader, focus traps, zoom, contrast, reduced motion, forced colors                       |
| Visual              | Responsive states                            | public/lobby/queue/game/result/lesson/settings at key viewports                                                |
| Performance         | Production build                             | route JS budgets, LCP/INP/CLS, board interaction, reconnect/sync                                               |
| Cross-browser       | Browser engines/devices                      | Chromium, Firefox, WebKit; recent iOS Safari and Android Chrome                                                |
| Recovery            | Failure injection                            | offline, Redis/backend unavailable, ack lost, duplicate/out-of-order event, token expiry, multi-tab            |

### 17.3 Critical reducer cases

- ack then broadcast for the same move;
- broadcast then ack;
- duplicate event ID;
- different event IDs for same ply;
- stale lower version;
- equal-version `move.accepted` then `game.ended`;
- version jump;
- lifecycle version without a move;
- snapshot with move count not equal to version;
- player disconnect/reconnect at adjacent versions;
- pending move superseded by another tab;
- invalid schema;
- game ID mismatch.

### 17.4 E2E scenarios

1. First visit creates a guest and displays mapped avatar.
2. Refresh recovers the guest without creating a new identity.
3. Two browser contexts queue and receive one game with opposite colors.
4. Both ready; board orientations and first turn are correct.
5. Click, keyboard, touch-emulated, castling, en passant, and promotion flows submit correct envelopes.
6. Duplicate move ack/event changes the board once.
7. Ack loss followed by retry uses the same IDs.
8. Version gap triggers one sync and converges.
9. Refresh in progress recovers board, moves, clocks, and presence.
10. One tab closes while another keeps the player connected.
11. Final disconnect/reconnect shows clocks continue and clears on recovery.
12. Resignation, timeout, no-show, abandonment, draw, and checkmate copy map correctly.
13. Active-game reset warns, abandons, clears the old identity, and cannot access the prior game as the new guest.
14. Deep link as a non-member reveals no opponent/game details.
15. 429 and 503 respect retry timing and never create duplicate identities/commands.

### 17.5 Quality gates

- TypeScript strict mode and no unchecked protocol casts.
- ESLint with import boundaries, hooks, accessibility, query, and no-restricted-storage rules.
- Prettier check.
- Unit/component coverage:
  - ≥ 90% branches for protocol reducer, clock, auth coordinator, and error mapping;
  - ≥ 80% branches overall frontend;
  - coverage is not a substitute for the E2E matrix.
- Zero serious/critical automated accessibility violations.
- No console errors, unhandled promises, hydration warnings, or leaked timers in E2E.
- All supported browser projects pass critical play flow.
- Production build, Docker smoke, dependency/license scan, and bundle budgets pass.

---

## 18. Phased implementation roadmap

Each phase is independently demonstrable and must pass its acceptance gate before the next phase depends on it.

### Phase 0 — Product, contract, and design closure

> **Status:** Complete — accepted 2026-07-28
> **Artifacts:** [`docs/frontend/`](docs/frontend/)

**Objective**

Freeze frontend-specific decisions and remove known ambiguities before implementation.

**Features/work**

- Confirm v1 screen inventory and non-goals.
- Record frontend ADRs for:
  - same-origin production topology;
  - `sessionStorage` socket token strategy;
  - Fetch abstraction;
  - shared protocol package;
  - Query/Zustand ownership;
  - snapshot/event reducer;
  - CSP/rendering tradeoff;
  - one visual theme.
- Turn supplied references into annotated wireframes for mobile, tablet, and desktop.
- Produce user-flow diagrams for bootstrap, queue, match, game, reconnect, terminal, and reset.
- Freeze component states and semantic design tokens.
- Resolve asset licensing and create avatar/piece/lesson-art inventory.
- Log backend gaps in §19 without expanding v1 scope.

**Pages/components**

- Low-fidelity `/`, `/play`, `/game/[id]`, `/learn`, `/learn/[piece]`, `/settings`.
- Design-token specimen and board interaction prototype.

**APIs**

- No mutation against runtime; validate all documented contracts and event ordering.

**Tests**

- Wireframe accessibility review.
- Token contrast check.
- Keyboard board prototype test with representative users.
- Contract fixture inventory review.

**Deliverables**

- Accepted frontend ADRs.
- Signed-off route map, flows, design tokens, component/state inventory, and asset register.

**Dependencies**

- Existing backend protocol v1.

**Acceptance criteria**

- Every backend endpoint/event has an owner and screen.
- No unsupported role/dashboard/list feature remains implied.
- Security/storage and recovery decisions are explicit.
- Mobile and desktop game layouts are approved before high-fidelity build.

### Phase 1 — Repository, runtime, and shared contracts

> **Status:** Complete — accepted 2026-07-28
> **Evidence:** [`docs/frontend/phase-1-acceptance.md`](docs/frontend/phase-1-acceptance.md)

**Objective**

Create a bootable, typed, reproducible frontend foundation without disturbing backend qualification.

**Features/work**

- Scaffold `frontend/` with current stable Next.js App Router, TypeScript strict mode, Tailwind, Vitest, and Playwright.
- Pin Node/npm compatible with the backend's Node 24/npm 11 policy.
- Run Next locally on port 5173.
- Add environment Zod validation.
- Create or extract `packages/protocol-v1`.
- Configure path aliases, lint rules, formatting, commit/build scripts, dependency updates, and bundle analyzer.
- Add frontend Docker development and production stages.
- Add Compose `web` service without editing user-owned backend behavior beyond required routing/origin integration.
- Add CI jobs isolated from backend jobs.

**Pages/components**

- Root layout, placeholder public page, health-neutral app shell, not-found, root errors.

**APIs**

- Schema fixtures compile; no live feature integration yet.

**Tests**

- Environment matrix unit tests.
- Shared contract build/tests.
- Next production build and container smoke.
- Backend verify remains green after protocol extraction.

**Deliverables**

- Reproducible `frontend/` package, lockfile, Dockerfile, CI foundation, shared contract artifact.

**Dependencies**

- Phase 0 decisions.

**Acceptance criteria**

- One documented command starts backend dependencies and frontend.
- Frontend loads at 5173 and backend accepts its REST/socket origin.
- Both backend and frontend consume the same protocol definitions or the temporary drift check is enforced.
- Production container runs as non-root and passes smoke.

### Phase 2 — Design system and responsive shell

> **Status:** Complete — accepted 2026-07-28
> **Evidence:** [`docs/frontend/phase-2-acceptance.md`](docs/frontend/phase-2-acceptance.md)

**Objective**

Implement the visual language and accessible primitives before feature screens.

**Features/work**

- Tailwind semantic theme variables and global CSS.
- `next/font` display/UI fonts.
- Core primitive library and Storybook.
- Public/guest shells, header, rail, mobile nav, breadcrumbs.
- Loading, empty, success, offline, and error patterns.
- Avatar mapping and optimized chess piece sprite.
- Responsive safe-area and container-query foundations.
- Motion tokens and reduced-motion behavior.

**Pages/components**

- High-fidelity static `/`, `/play`, `/game/demo`, `/learn/king`, `/settings` stories/routes using fixtures.

**APIs**

- None; typed fixture data only.

**Tests**

- Primitive component tests.
- Axe and keyboard checks.
- Visual snapshots at 320, 390, 768, 1024, and 1440 px.
- Color contrast/forced-colors tests.
- Font/image layout shift check.

**Deliverables**

- Design system, Storybook catalog, responsive application shell, approved game-board visuals.

**Dependencies**

- Phase 1.

**Acceptance criteria**

- All primitive states are documented.
- No blue/purple/neon or generic gradient treatment appears.
- Core pages remain usable at 200% zoom and keyboard-only.
- Board squares meet touch target and visual-state requirements.

### Phase 3 — REST foundation and anonymous session lifecycle

**Objective**

Create/recover/renew/reset guest identity safely and expose a stable guest session to features.

**Features/work**

- `apiFetch`, `ApiError`, timeouts, correlation IDs, Zod parsing.
- Query client factory and query keys.
- Token/idempotency session-storage adapter.
- Session bootstrap coordinator and renewal scheduler.
- Guest session gate and identity view model.
- Avatar fallback.
- Reset identity confirmation/cleanup.
- Error-code-to-plain-language mapping for HTTP.

**Pages/components**

- Guest-aware landing CTA, `/play` identity shell, `/settings` identity/reset section.

**APIs**

- `POST /v1/session`
- `POST /v1/session/renew`
- `GET /v1/session`
- `POST /v1/session/reset`
- `GET /v1/games/active` for bootstrap hint

**Tests**

- First visit, cookie recovery, token recovery through renew, near-expiry renew, lost response with same key, 401, 429, 503, and reset cleanup.
- Assert no token enters Query cache/logs/localStorage.

**Deliverables**

- Complete anonymous session lifecycle and documented storage/security behavior.

**Dependencies**

- Phase 2 and live backend.

**Acceptance criteria**

- Refresh does not create a second guest while a valid session exists.
- Bounded retries reuse keys.
- Reset clears all old guest state.
- Active identity expiry never silently moves an in-progress game to a new identity.

### Phase 4 — Realtime transport, recovery core, and app navigation

**Objective**

Establish one authenticated, observable Socket.IO connection and authoritative recovery path.

**Features/work**

- Lazy realtime client and typed command emitter.
- Connection/reconnect/heartbeat state.
- Server-event and ack validation.
- Event ID LRU and transport telemetry.
- `session.ready` reconciliation.
- HTTP active/snapshot hooks.
- Dynamic game route validation and deep-link error states.
- Capability navigation and route gates.
- Sync command with HTTP snapshot fallback.

**Pages/components**

- Connection badge, reconnect banner, active-game resume card, game recovery shell.

**APIs/events**

- `GET /v1/games/active`
- `GET /v1/games/:id/snapshot`
- `heartbeat.ping` / `heartbeat.pong`
- `game.sync`
- `session.ready`
- `game.snapshot`
- `server.error`

**Tests**

- Connect auth success/failure, Redis unavailable handshake, reconnect, duplicate events, active game disagreement, deep links, non-member 403, snapshot fallback.

**Deliverables**

- Realtime service, transport store, recovery route, connection/recovery UX.

**Dependencies**

- Phase 3.

**Acceptance criteria**

- Exactly one socket/timer exists per tab.
- A refresh during an allocated/in-progress game restores the authoritative snapshot.
- A transport loss never clears the last safe board.
- Private deep-link failures disclose no game/opponent detail.

### Phase 5 — Lobby and matchmaking

**Objective**

Deliver the complete instant-match queue journey.

**Features/work**

- Fixed blitz match card.
- Join/leave commands, queue state, intent recovery, elapsed time, advisory position.
- Rate limit and service degradation UX.
- Match-found transition, join deadline, provisional opponent/color/time-control view.
- Active-game precedence and `ALREADY_IN_GAME` recovery.
- Warm game chunks after queue join.

**Pages/components**

- `/play`, `MatchCard`, `QueuePanel`, `QueueTimer`, `MatchFoundTransition`, `ActiveGameBanner`.

**APIs/events**

- `queue.join`
- `queue.leave`
- `queue.joined`
- `queue.left`
- `match.found`
- active game recovery on conflict

**Tests**

- Join, duplicate join, cancel, disconnect queue removal, reconnect intent, match, rate limit, 503, double click, second-tab behavior.

**Deliverables**

- Production-ready lobby/matchmaking vertical slice.

**Dependencies**

- Phase 4.

**Acceptance criteria**

- UI never shows queued before authoritative confirmation.
- Duplicate interactions create one queue entry.
- Match routes both players to the same game and correct provisional color.
- Queue states are understandable without animation or color.

### Phase 6 — Chessboard and client game domain

**Objective**

Build an accessible, high-performance board and game presentation independent of live move submission.

**Features/work**

- FEN parser/view model and client `chess.js` adapter.
- Board orientation, coordinates, piece rendering, selection, drag/tap/keyboard.
- Legal-target hints as non-authoritative UX.
- Promotion dialog.
- Player bars, clocks from fixture/server time, move list, captured pieces.
- Check/last-move/selected/pending visual states.
- Screen-reader announcements and textual equivalent.

**Pages/components**

- Full `/game/[id]` presentation with fixture snapshots and all statuses.

**APIs**

- Snapshot payload consumption only.

**Tests**

- FEN positions, orientations, every input method, promotion, castling/en passant proposals, focus movement, reduced motion, 200% zoom, board render performance.

**Deliverables**

- Complete board component library and game view model.

**Dependencies**

- Phases 2 and 4.

**Acceptance criteria**

- The board never asserts a result or mutates authoritative state.
- All 64 squares are correctly navigable and announced.
- Black orientation preserves correct coordinate semantics.
- Clock ticks do not rerender the board.

### Phase 7 — Authoritative gameplay transaction

**Objective**

Connect readiness and move submission to the backend with exact retry/version semantics.

**Features/work**

- `game.ready` orchestration.
- Pending move overlay and one-in-flight guard.
- Move ack/event reducer.
- Version-gap detection and sync.
- Ack timeout retries with stable identifiers.
- Confirmed piece animation and SAN announcement.
- Error-specific rollback/recovery.

**Pages/components**

- Waiting-for-opponent state, live board, move feedback, sync banner.

**APIs/events**

- `game.ready`
- `game.started`
- `move.submit`
- `move.accepted`
- `move.rejected`
- `game.sync`

**Tests**

- Two-player readiness, legal/illegal/off-turn/stale moves, duplicate IDs, ack/broadcast order, lost ack, process interruption recovery, version lifecycle without move.

**Deliverables**

- End-to-end server-authoritative move loop.

**Dependencies**

- Phases 5 and 6.

**Acceptance criteria**

- One proposal produces at most one visual move.
- No second local move submits while the first is uncertain.
- Stale/gapped clients sync instead of reapplying guesses.
- A backend-accepted move survives lost broadcast/reload.

### Phase 8 — Clocks, presence, terminal states, and game actions

**Objective**

Complete every lifecycle and terminal UX path.

**Features/work**

- Server-offset clock display and thresholds.
- Opponent disconnect/grace state with “clocks continue.”
- Reconnect recovery.
- Resign confirmation/idempotent command.
- Result mapping for all result/termination values.
- No-show, timeout, abandonment, double abandon, draw, and checkmate copy.
- Terminal cache behavior, return to lobby, PGN copy/download while available.
- Sound/haptic-safe optional cues.

**Pages/components**

- `ReconnectBanner`, `GraceCountdown`, `ResignDialog`, `ResultSheet`, terminal game route.

**APIs/events**

- `player.disconnected`
- `player.reconnected`
- `game.resign`
- `game.ended`
- heartbeat clock samples

**Tests**

- Every termination enum, resign retry, timeout-at-zero display, final-tab disconnect, reconnect, game end companion event, PGN unavailable after recovered terminal snapshot.

**Deliverables**

- Complete game lifecycle UX and plain-language result catalog.

**Dependencies**

- Phase 7.

**Acceptance criteria**

- Browser never declares a flag fall/result before the server.
- Presence/clock urgency is accessible without color/sound.
- Every wire result and termination has tested copy.
- Resignation/reset consequences are explicit before action.

### Phase 9 — Resilience and browser lifecycle

**Objective**

Prove convergence through refreshes, failures, multi-tab use, and uncertain delivery.

**Features/work**

- Visibility/online/offline listeners.
- Multi-tab hints.
- Queue-intent reconnect.
- Snapshot fallback hierarchy.
- Bounded retry scheduler with jitter and cancellation.
- Service-unavailable and offline states.
- Storage schema migrations/corruption recovery.
- Protocol mismatch “update required” state.

**Pages/components**

- Offline/recovery overlays and non-destructive retry panels across lobby/game.

**APIs/events**

- All recovery paths under injected failures.

**Tests**

- Redis/backend outage, adapter degradation, offline/online, tab sleep, expired token, storage unavailable, duplicate/out-of-order events, rolling backend restart.

**Deliverables**

- Recovery runbook and automated failure suite.

**Dependencies**

- Phases 3–8.

**Acceptance criteria**

- Last safe game state remains readable during outage.
- Recovery cannot create duplicate session/game commands.
- All uncertain mutation paths end in sync or explicit user action.
- Browser resource/timer/socket cleanup passes leak checks.

**MVP feature-complete point:** end of Phase 9.

### Phase 10 — Learning experience and editorial polish

**Objective**

Translate the supplied piece-learning reference into a useful, static, accessible companion experience.

**Features/work**

- Six typed local lessons.
- Piece tabs/rail, hero art, concise rules, example positions, previous/next.
- Interactive example board isolated from live-game transport.
- SEO metadata and structured content.
- Feature flag and asset optimization.

**Pages/components**

- `/learn`
- `/learn/[piece]`

**APIs**

- None; local versioned content.

**Tests**

- Compile-time content validation, all known/unknown slugs, keyboard tabs, text equivalents, image budgets, and rule-accuracy review.

**Deliverables**

- Complete learning hub matching the reference's strongest ideas without its contrast/readability issues.

**Dependencies**

- Phases 2 and 6; does not block core play.

**Acceptance criteria**

- Lesson pages ship no Socket.IO code.
- Every interactive diagram has a text equivalent.
- All art has dimensions, provenance, and optimized formats.

### Phase 11 — Accessibility, performance, security, and observability hardening

**Objective**

Turn feature-complete software into a measurable, supportable production candidate.

**Features/work**

- Manual screen-reader/keyboard/zoom/forced-colors audit.
- CSP report-only, remediation, enforcement.
- Security/privacy header and storage audit.
- Web Vitals and frontend telemetry.
- Bundle analysis and dependency removal.
- Memoization/virtualization only from profiles.
- Error reporting with redaction and release mapping.
- Cross-browser fixes and responsive device lab pass.

**Pages/components**

- All.

**APIs**

- Correlation/telemetry propagation across all HTTP/socket operations.

**Tests**

- Lighthouse CI, axe, manual assistive technology, dependency/license/secret/container scans, CSP tests, bundle budgets.

**Deliverables**

- Accessibility conformance report, performance report, threat model, telemetry dashboard, alert definitions.

**Dependencies**

- Phases 0–10.

**Acceptance criteria**

- No known critical/serious accessibility issues.
- All §15 budgets pass or have an approved dated exception.
- No token/identifier leak in telemetry or storage.
- CSP enforced in production-shaped smoke.

### Phase 12 — End-to-end, failure, and release qualification

**Objective**

Generate repeatable evidence that the frontend and backend operate correctly together.

**Features/work**

- Production-shaped same-origin edge topology.
- Full Playwright two-user suite against real backend datastores.
- Backend replica rolling-restart test during live game.
- Browser/network throttling and long-session soak.
- Synthetic concurrency for session bootstrap/lobby pages without replacing backend load qualification.
- Visual regression baselines and browser matrix.
- Artifact retention and exception register.

**Pages/components**

- All critical routes/states.

**APIs**

- Complete HTTP and Socket.IO v1 contract.

**Tests**

- §17 E2E/recovery matrix, cross-browser, mobile emulation, production Docker smoke, soak.

**Deliverables**

- Versioned qualification report with screenshots, traces, videos on failure, bundle/Lighthouse/axe results, and release SHA.

**Dependencies**

- Phase 11 and backend qualification topology.

**Acceptance criteria**

- Two real browser contexts complete a game through the same edge.
- Refresh, adapter degradation, and rolling restart converge through snapshot recovery.
- No duplicate visual move, guest creation, socket, or timer is detected.
- All exceptions have owner, risk, expiry, and approval.

### Phase 13 — Production release and operations

**Objective**

Deploy, observe, canary, and safely roll back the frontend.

**Features/work**

- Multi-stage non-root image and immutable release.
- Same-origin edge routes and WebSocket upgrade/stickiness validation.
- CDN/static caching rules that never cache guest API responses.
- Environment/secret injection and startup validation.
- Canary rollout, smoke, rollback, and cache purge procedure.
- Support/error runbooks and browser compatibility statement.
- Release notes and operational ownership.

**Pages/components**

- Production metadata, icons, manifest, robots/sitemap, legal/accessibility statements.

**APIs**

- Production origin, HTTPS/WSS, cookies, CORS, socket upgrades, health routing.

**Tests**

- Post-deploy synthetic bootstrap, queue with controlled test guest strategy, snapshot recovery, CSP, headers, cache behavior, rollback rehearsal.

**Deliverables**

- Production deployment, dashboards/alerts, rollback/runbooks, release sign-off.

**Dependencies**

- Phase 12.

**Acceptance criteria**

- Canary metrics remain within baseline.
- Rollback restores the previous frontend without protocol incompatibility.
- Public edge returns no metrics/readiness internals.
- On-call can connect correlation IDs from frontend reports to backend traces.

**Production-ready point:** end of Phase 13.

---

## 19. Backend contract gaps and future extensions

These findings prevent accidental frontend invention. They do not block the core v1 journey unless marked.

| Gap                                                                                                  | V1 frontend behavior                                                                | Future contract                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| No queued-state read in `session.ready` or REST                                                      | Keep queue intent per tab and idempotently repeat `queue.join` after reconnect      | Add authoritative matchmaking state to `session.ready` or `GET /games/active` companion endpoint |
| `game.snapshot` omits PGN                                                                            | PGN copy/download is available only after receiving `game.ended` in the current tab | Add PGN to terminal snapshot or a member-authorized game detail endpoint                         |
| No game list/history                                                                                 | Do not build history table, pagination, filters, search, or sorting                 | Add paginated member game-history endpoint with cursor/filter/sort contract                      |
| One fixed blitz mode                                                                                 | Show one honest `5+2` option; no fake selector                                      | Add modes/time controls endpoint or versioned queue payload support                              |
| No rematch command                                                                                   | Result sheet returns to lobby                                                       | Add rematch negotiation/allocation protocol                                                      |
| No legal-moves endpoint                                                                              | Use client `chess.js` for hints; server still adjudicates                           | Optional legal-target field in snapshot for thinner clients                                      |
| Avatar is a key only                                                                                 | Maintain checked client asset map and fallback                                      | Publish versioned avatar manifest or resolved CDN URL                                            |
| No roles/permissions                                                                                 | One guest capability map; backend authorizes                                        | Add identity roles/claims and permission endpoint only when a role feature exists                |
| Protocol docs and implemented `/readyz` response differ (`degraded/draining` vs `unavailable/state`) | Frontend does not consume it; infrastructure tests use implementation               | Align normative protocol documentation with implementation                                       |
| Architecture describes `localStorage` JWT                                                            | Use `sessionStorage` plus cookie-backed renewal and record frontend ADR             | Optionally accept HttpOnly cookie during Socket.IO auth to eliminate JS-readable persistence     |
| No runtime feature-flag endpoint                                                                     | Build/deploy-time typed flags only                                                  | Add signed/cached public configuration endpoint if runtime rollout is required                   |
| No spectator/public game access                                                                      | Deep links require member session                                                   | Add explicit spectator authorization and public snapshot model                                   |

---

## 20. Deployment and production readiness checklist

### Build and configuration

- [ ] Current stable framework/dependency versions are pinned; lockfile committed.
- [ ] Typecheck, lint, format, unit, component, E2E, build, and bundle gates pass.
- [ ] Production environment schema passes at image startup.
- [ ] Build SHA/release is embedded without exposing secrets.
- [ ] Source maps are uploaded privately and removed from public artifact paths.
- [ ] Frontend Docker image is multi-stage, minimal, non-root, read-only compatible, and scanned.
- [ ] SBOM, dependency vulnerabilities, licenses, and secrets scans pass.

### Edge/network

- [ ] One HTTPS origin serves frontend plus `/v1` and `/socket.io`.
- [ ] WebSocket upgrade works; polling fallback has required stickiness.
- [ ] Exact frontend origin is in backend allowlist.
- [ ] Secure cookie attributes verified through the public edge.
- [ ] HSTS and security headers present.
- [ ] CSP is enforced with no unexpected violations.
- [ ] `/metrics` and internal readiness are not publicly exposed.
- [ ] Guest API/socket responses are never CDN cached.
- [ ] Fingerprinted assets receive long immutable caching.

### Functional/recovery

- [ ] First visit, return visit, renew, and reset pass.
- [ ] Two-user match and full move flow pass.
- [ ] Direct game deep link and refresh recovery pass.
- [ ] Version gap, ack loss, duplicate event, and backend rolling restart converge.
- [ ] Offline/online and tab sleep recover.
- [ ] All result/termination states render tested copy.
- [ ] Unknown avatar has safe fallback.
- [ ] Protocol version mismatch presents update guidance.

### UX/accessibility

- [ ] Mobile portrait/landscape, tablet, desktop, and 200% zoom pass.
- [ ] Keyboard-only play flow passes.
- [ ] Screen-reader board and move announcements manually verified.
- [ ] Reduced motion and forced colors pass.
- [ ] Touch targets and focus restoration pass.
- [ ] No status relies on color, sound, or animation alone.
- [ ] Empty/loading/error/success states exist for every screen.

### Performance

- [ ] Route bundle budgets pass.
- [ ] Core Web Vitals lab and field instrumentation configured.
- [ ] Board does not rerender from clock ticks.
- [ ] Fonts/images produce no material layout shift.
- [ ] One socket/heartbeat per tab verified.
- [ ] Production load/recovery traces retained.

### Observability/support

- [ ] Frontend errors include release and correlation ID.
- [ ] Token/cookie/storage redaction tests pass.
- [ ] Session, socket, queue, move, sync, error, and Web Vital dashboards exist.
- [ ] Alerts have actionable thresholds and runbooks.
- [ ] Browser support statement published.
- [ ] Canary, rollback, cache purge, and incident procedures rehearsed.
- [ ] Qualification exceptions have owner and expiry.

### Release

- [ ] Backend protocol v1 compatibility checked against the candidate frontend.
- [ ] Database/backend release is compatible with previous and candidate frontend during rollback window.
- [ ] Canary synthetic journey passes.
- [ ] Error, sync, and reconnect rates remain within baseline.
- [ ] Product, engineering, accessibility, security, and operations sign-off recorded.

---

## 21. Deliverable traceability

| Requested deliverable                      | Location in this document |
| ------------------------------------------ | ------------------------- |
| 1. Complete frontend architecture document | §§1, 2, 4, 6, 11, 16      |
| 2. UI/UX design system                     | §§3, 5, 13, 14            |
| 3. Component hierarchy                     | §7                        |
| 4. Folder structure                        | §8                        |
| 5. Routing map                             | §9                        |
| 6. API integration matrix                  | §10                       |
| 7. State management strategy               | §12                       |
| 8. Phased implementation roadmap           | §18                       |
| 9. Testing strategy                        | §17                       |
| 10. Deployment/production checklist        | §20                       |

---

## 22. Definition of done

The frontend is complete only when:

- all Phase 13 acceptance criteria pass;
- all HTTP endpoints and Socket.IO v1 commands/events are represented by shared validated contracts and tested consumers;
- the two-player production-shaped E2E suite demonstrates matchmaking, gameplay, terminal state, refresh, and reconnect;
- snapshots recover every uncertain realtime path;
- the board is usable by pointer, touch, keyboard, and screen reader;
- performance, accessibility, security, browser, container, and recovery evidence is attached to the release;
- no unsupported backend capability is represented as a working frontend feature;
- the candidate can be canaried and rolled back without corrupting or stranding active games.
