# Component and State Inventory

> **Status:** Frozen for Phase 1–8 implementation
> **Rule:** A component is not complete until every applicable state below is
> implemented and tested.

## Dependency hierarchy

```text
routes
  → feature compositions
    → domain components
      → shared UI primitives
        → tokens/styles

transport/API → feature models/hooks → feature compositions
```

Forbidden directions:

- primitives importing features;
- transport/API importing JSX;
- Zustand importing a whole Query snapshot;
- route files containing protocol reducers;
- learning components importing Socket.IO/game transport.

## Shared primitives

| Component     | Required variants/states                                                        | Accessibility contract                     |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| `Button`      | primary, secondary, quiet, destructive; hover, focus, active, disabled, pending | Native button, stable name, pending status |
| `IconButton`  | default, danger; tooltip; disabled/pending                                      | 44 px, accessible name                     |
| `Card`        | default, inverse, interactive, selected                                         | Semantic element chosen by consumer        |
| `Badge`       | neutral, success, warning, danger                                               | Text/icon plus color                       |
| `Avatar`      | all eight keys, loading, unknown fallback, image failure                        | Guest name alt or decorative by context    |
| `Dialog`      | default, destructive, promotion                                                 | Focus trap/restore, heading/description    |
| `Drawer`      | collapsed, opening, open, closing                                               | Modal/nonmodal semantics by use            |
| `Tooltip`     | hover/focus, delayed, disabled                                                  | Supplementary only                         |
| `Toast`       | info, success, failure                                                          | Noncritical polite live region             |
| `Skeleton`    | text, avatar, card, board, player bar                                           | Hidden from accessibility tree             |
| `ErrorState`  | inline, route, blocking                                                         | Recovery action and optional correlation   |
| `EmptyState`  | compact, route                                                                  | Explanation and primary next step          |
| `Field`       | rest, focus, valid, invalid, disabled                                           | Label, description, error association      |
| `Switch`      | on/off, disabled                                                                | Native/ARIA checked state                  |
| `Select`      | closed/open, value/error/disabled                                               | Full keyboard support                      |
| `Breadcrumbs` | current/intermediate, overflow                                                  | `nav` label and `aria-current=page`        |

## Navigation and shell

### `AppHeader`

States:

- public;
- guest bootstrapping;
- guest connected;
- reconnecting;
- offline;
- active-game focus.

### `ConnectionBadge`

States:

- connecting;
- connected;
- reconnecting;
- offline;
- service unavailable.

It is not a raw green/red dot. It includes text or an accessible expanded
description.

### `DesktopRail` / `MobileNav`

States:

- current route;
- active game changes Play to Resume;
- Learn flag on/off;
- item disabled with reason;
- focus game collapsed/removed.

## Session feature

| Component/model      | States                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `GuestSessionGate`   | checking token, cookie recovery, renewing, creating, ready, rate limited, unavailable, identity lost |
| `IdentityCard`       | loading, ready, expiring soon, unknown avatar fallback                                               |
| `RenewalCoordinator` | scheduled, renewing, retry wait, renewed, failed                                                     |
| `ResetIdentityCard`  | idle, active-game warning, confirmation, pending, retryable error, definitive error, success cleanup |

State transitions are single-flight. A create/renew/reset attempt retains one
idempotency key through retries.

## Matchmaking feature

| Component/model        | States                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `MatchCard`            | disabled bootstrap, ready, joining, queued, leaving, active game, matched                         |
| `QueuePanel`           | just joined, queued with/without position, reconnecting intent, timed out, disconnected, canceled |
| `QueueTimer`           | running, background/resumed, stopped                                                              |
| `ActiveGameBanner`     | loading, live, reconnecting, terminal transition                                                  |
| `MatchFoundTransition` | received, navigating, ready command pending, join deadline near                                   |

No queue position is synthesized when the server omits it.

## Game feature hierarchy

```text
GameSessionBoundary
├─ OpponentBar
├─ BoardRegion
│  ├─ ChessBoard
│  │  └─ ChessSquare × 64
│  │     └─ ChessPiece?
│  ├─ PendingMoveLayer
│  ├─ PromotionDialog
│  └─ BoardAnnouncements
├─ SelfBar
├─ GameContextPanel / MobileGameDrawer
│  ├─ GameStatus
│  ├─ MoveList
│  ├─ CapturedPieces
│  └─ GameActions
├─ ReconnectBanner
└─ ResultSheet
```

### `GameSessionBoundary`

- invalid ID;
- snapshot loading;
- HTTP recovered;
- socket recovered;
- unauthorized/identity lost;
- unavailable/non-member;
- service unavailable with safe snapshot;
- protocol update required.

### `PlayerBar`

- connected;
- disconnected self/opponent;
- current turn;
- waiting;
- winner/loser/draw;
- name truncated;
- avatar fallback.

### `Clock`

- not started;
- running self/opponent;
- paused/null;
- normal;
- under 30 seconds;
- under 10 seconds;
- visually zero awaiting server;
- terminal.

Clock urgency includes text/shape/weight and restrained threshold
announcements.

### `ChessBoard`

Global states:

- loading skeleton;
- waiting/read-only;
- live own turn;
- live opponent turn;
- selection active;
- drag active;
- promotion modal;
- move pending;
- sync read-only;
- reconnect read-only;
- terminal inspectable;
- black/white orientation;
- coordinates on/off;
- reduced motion;
- forced colors.

### `ChessSquare`

- empty/occupied;
- focused;
- selected;
- legal empty target;
- legal capture target;
- last move source/target;
- checked king;
- pending source/target;
- drag source/over target;
- disabled/read-only.

Precedence:

1. focus-visible;
2. check;
3. pending;
4. selected/legal;
5. last move;
6. base square.

No state may make the piece silhouette unreadable.

### `PromotionDialog`

- opening/open;
- queen/rook/bishop/knight focus;
- confirm by selection;
- canceled;
- submission begins after choice.

### `MoveList`

- no moves;
- one half move;
- paired rows;
- current move;
- new move while at end → follow;
- new move while user scrolled → show “new move” control;
- more than 200 plies → virtualized feature chunk;
- terminal.

### `GameActions`

- no supported action while waiting;
- resign eligible;
- resign confirmation/pending/retry;
- disabled during uncertain move/sync;
- terminal return to lobby;
- copy/download PGN only when payload exists.

There is no draw offer, rematch, chat, or spectator action in v1.

### `ReconnectBanner`

- transport reconnecting;
- opponent grace;
- self recovered;
- service unavailable;
- offline;
- manual retry;
- cleared after snapshot.

### `ResultSheet`

Result states:

- white win;
- black win;
- draw;
- void.

Termination states:

- checkmate;
- stalemate;
- insufficient material;
- threefold repetition;
- fifty-move;
- resignation;
- timeout;
- abandonment;
- double abandonment;
- no-show.

Each result/termination combination maps to viewer-aware title, explanation,
score, and available actions. Raw enum values never appear as primary copy.

## Learning feature

| Component         | States                                                 |
| ----------------- | ------------------------------------------------------ |
| `LessonGrid`      | six lessons, flag hidden, optional art unavailable     |
| `PieceTabs`       | six known pieces, selected, focus, horizontal overflow |
| `PieceLessonHero` | art loading, loaded, unavailable fallback              |
| `ExampleBoard`    | static, focus exploration, reduced motion              |
| `LessonPager`     | first, middle, last                                    |

Learning routes must work without guest providers, REST, or Socket.IO.

## Settings feature

| Component           | States                                                          |
| ------------------- | --------------------------------------------------------------- |
| `PreferencesForm`   | pristine, dirty, validating, saved locally, storage unavailable |
| `CoordinateSetting` | on/off                                                          |
| `InputModeSetting`  | tap, drag, both                                                 |
| `MotionSetting`     | system, reduced, full                                           |
| `SoundSetting`      | off/on, feature flag unavailable                                |
| `ResetIdentityCard` | see Session feature                                             |

## Route state matrix

| Route            | Loading                  | Empty                    | Error                                | Success                 |
| ---------------- | ------------------------ | ------------------------ | ------------------------------------ | ----------------------- |
| `/`              | Hero/media skeleton only | Not applicable           | Media fallback; page remains useful  | CTA and product content |
| `/play`          | Guest/match skeleton     | No active game is normal | Session/socket/action-specific       | Ready or queued lobby   |
| `/game/[id]`     | Board geometry skeleton  | Not applicable           | Invalid/private/unavailable/recovery | Waiting/live/terminal   |
| `/learn`         | Optional art skeleton    | Feature disabled → 404   | Art fallback                         | Six lessons             |
| `/learn/[piece]` | Hero/example skeleton    | Unknown → 404            | Content fallback                     | Lesson                  |
| `/settings`      | Identity/form skeleton   | Not applicable           | Storage/session-specific             | Preferences/reset       |

## Component definition of done

- All applicable variants/states above exist.
- Keyboard and focus behavior is documented in story/test.
- Loading/error text does not disclose technical internals.
- Reduced motion and forced colors have a story/test.
- Component does not own data outside its architecture layer.
- Visual and accessible name remain stable during pending state.
