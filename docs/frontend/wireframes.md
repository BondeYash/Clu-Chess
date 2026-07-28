# Annotated Frontend Wireframes

> **Status:** Approved low-fidelity layout contract
> **Fidelity:** Structure, hierarchy, responsive behavior, states, and
> accessibility annotations—not final artwork

## Shared notation

- `[ ]` interactive control.
- `( )` status/information.
- `~~~` skeleton/loading region.
- `!` inline blocking warning.
- All dimensions are intent, not fixed pixel implementation.

## Responsive shell

### Mobile public shell

```text
┌──────────────────────────────────────┐
│ [CluChess]              [Play now]   │  Header, 64 px
├──────────────────────────────────────┤
│ [Skip to main content]               │  Visible on focus
│                                      │
│ MAIN                                 │
│ Single-column content                │
│ 16 px side gutters                   │
│                                      │
├──────────────────────────────────────┤
│ Privacy · Terms · Accessibility      │
└──────────────────────────────────────┘
```

### Mobile guest shell outside live play

```text
┌──────────────────────────────────────┐
│ CluChess  (Connected)   [Avatar ▾]   │
├──────────────────────────────────────┤
│ MAIN                                 │
│ 16 px side gutters                   │
│ max readable width                   │
│                                      │
├──────────────────────────────────────┤
│ [♟ Play]  [♞ Learn]  [⚙ Settings]   │  Safe-area padded
└──────────────────────────────────────┘
```

### Desktop guest shell

```text
┌──────┬──────────────────────────────────────────────────────┐
│ Logo │ Header: page title        (Connected) [Guest avatar] │
│      ├──────────────────────────────────────────────────────┤
│ Play │                                                      │
│ Learn│ MAIN: centered content container                     │
│ Set. │                                                      │
│      │                                                      │
└──────┴──────────────────────────────────────────────────────┘
 72 px                     max content 1280 px
```

The rail collapses in game focus mode. Icon-only desktop controls retain
tooltips and accessible names.

---

## `/` landing

### Mobile

```text
┌──────────────────────────────────────┐
│ CluChess                 [Play now]  │
├──────────────────────────────────────┤
│                                      │
│        ♞  quiet knight art           │  Decorative; fixed aspect ratio
│                                      │
│  A quieter way to play.              │  Display serif
│  Instant 5+2 chess with no account.  │  Plain-language body
│                                      │
│  [Find a match]                      │  Primary, 48 px
│  [Learn the pieces]                  │  Secondary
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Anonymous by design           │  │
│  │ Name/avatar generated for you │  │
│  └────────────────────────────────┘  │
│                                      │
│  How it works                        │
│  1. Get a guest identity             │
│  2. Join the blitz queue             │
│  3. Recover if you reconnect         │
│                                      │
├──────────────────────────────────────┤
│ Privacy · Terms · Accessibility      │
└──────────────────────────────────────┘
```

Annotations:

- Landing does not create a guest or load Socket.IO.
- Hero art never pushes the CTA below the first mobile viewport at common
  heights.
- “No account” is paired with the recovery limitation near the CTA.

### Desktop

```text
┌──────────────────────────────────────────────────────────────────────┐
│ CluChess             Play             Learn        [Play now]       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  A quieter way       ┌───────────────────────────────────────────┐   │
│  to play.            │                                           │   │
│                      │    editorial knight + board composition   │   │
│  Instant 5+2 chess   │    (warm, no neon/gradient)               │   │
│  with no account.    │                                           │   │
│                      └───────────────────────────────────────────┘   │
│  [Find a match] [Learn the pieces]                                  │
│                                                                      │
│  Anonymous · Server-authoritative · Reconnectable                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## `/play` lobby

### Mobile: ready

```text
┌──────────────────────────────────────┐
│ Play        (Connected) [Knight ▾]   │
├──────────────────────────────────────┤
│ Good evening,                        │
│ SilentKnight482                      │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ BLITZ                            │ │
│ │ 5 minutes + 2 seconds            │ │
│ │                                  │ │
│ │ One opponent · Random color      │ │
│ │                                  │ │
│ │ [Find a match]                   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Learn while you wait             │ │
│ │ [How the knight moves →]         │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ [Play]       [Learn]      [Settings] │
└──────────────────────────────────────┘
```

### Mobile: queued

```text
┌──────────────────────────────────────┐
│ Play        (Connected) [Knight ▾]   │
├──────────────────────────────────────┤
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Finding a player…               │ │  role=status
│ │                                  │ │
│ │          00:24                   │ │  elapsed, tabular
│ │   Queue position: about 2        │ │  only when server supplies
│ │                                  │ │
│ │ [Cancel search]                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ You can leave this screen; do not    │
│ imply a guaranteed queue position.   │
├──────────────────────────────────────┤
│ [Play•]      [Learn]      [Settings] │
└──────────────────────────────────────┘
```

### Mobile: active game precedence

```text
┌──────────────────────────────────────┐
│ Play        (Recovering) [Knight ▾]  │
├──────────────────────────────────────┤
│ ! You have a game in progress        │
│ ┌──────────────────────────────────┐ │
│ │ vs. NobleRook91                 │ │
│ │ Your turn · 03:42               │ │
│ │ [Resume game]                   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Find match is unavailable until the  │
│ active game ends.                    │
└──────────────────────────────────────┘
```

### Desktop

```text
┌──────┬───────────────────────────────────────────────────────────────┐
│ Nav  │ Play                         (Connected) [SilentKnight482 ▾]  │
│      ├───────────────────────────────────────────────────────────────┤
│      │                                                               │
│      │  Welcome back                 ┌────────────────────────────┐   │
│      │  [Identity card]              │ BLITZ  5 + 2              │   │
│      │                               │                            │   │
│      │  [Active game, if any]        │ Random color              │   │
│      │                               │ [Find a match]             │   │
│      │  [Learn preview]              └────────────────────────────┘   │
└──────┴───────────────────────────────────────────────────────────────┘
```

Lobby state set:

- session bootstrap;
- socket connecting/reconnecting/offline;
- ready;
- joining;
- queued;
- leaving;
- match found;
- rate limited with countdown;
- service unavailable with retry;
- active game;
- identity lost.

---

## `/game/[gameId]`

### Mobile portrait: waiting/live

```text
┌──────────────────────────────────────┐
│ [Menu]  Opponent connection   [•••] │
├──────────────────────────────────────┤
│ [Avatar] NobleRook91       04:58.2   │  Opponent bar
│          Black · Connected           │
├──────────────────────────────────────┤
│ 8  r  n  b  q  k  b  n  r          │
│ 7  p  p  p  p  p  p  p  p          │
│ 6  ·  ·  ·  ·  ·  ·  ·  ·          │
│ 5  ·  ·  ·  ·  ·  ·  ·  ·          │  Board uses full width
│ 4  ·  ·  ·  ·  ·  ·  ·  ·          │  8×8 semantic grid
│ 3  ·  ·  ·  ·  ·  ·  ·  ·          │
│ 2  P  P  P  P  P  P  P  P          │
│ 1  R  N  B  Q  K  B  N  R          │
│    a  b  c  d  e  f  g  h          │
├──────────────────────────────────────┤
│ [Avatar] SilentKnight482   05:00.0   │  Self bar
│          White · Your turn           │
├──────────────────────────────────────┤
│ Last: —                  [Moves ↑]   │  Context drawer handle
│ [Moves & details]           [Resign]  │  Only supported actions shown
└──────────────────────────────────────┘
```

Mobile annotations:

- General bottom navigation is removed during an active game.
- Board size is constrained by both inline width and remaining viewport height.
- Context drawer cannot cover the active clock or promotion dialog.
- On black orientation, visual order rotates while labels/keyboard semantics
  remain correct.
- Unsupported actions such as draw offer, rematch, and chat are not rendered.

### Mobile: pending move

```text
Selected source: copper outline
Legal targets: centered shape/dot plus accessible label
Pending source/target: low-opacity brass hatch
Board input: locked to a second local move
Status: "Submitting e4…" in polite live region
```

### Mobile: reconnecting

```text
┌──────────────────────────────────────┐
│ ! Reconnecting…                      │
│ Your last confirmed position is safe.│
│ Clocks continue on the server.       │
│ [Retry now]                          │
├──────────────────────────────────────┤
│ Last confirmed board, read-only      │
└──────────────────────────────────────┘
```

### Mobile: result

```text
┌──────────────────────────────────────┐
│ Final board (still inspectable)      │
├──────────────────────────────────────┤
│            Checkmate                 │  Focused dialog/sheet
│            You won                   │
│                                      │
│  SilentKnight482  0 — 1 NobleRook91 │  Correct perspective/result copy
│  [Copy PGN] if received              │
│  [Return to lobby]                   │
└──────────────────────────────────────┘
```

Result score text is derived carefully from `result`, not the viewer's
perspective alone. The example is illustrative and must be corrected by the
view model.

### Tablet landscape

```text
┌──────────────────────────────────────────────────────────────────┐
│ Opponent + clock                               Connection/menu    │
├───────────────────────────────────┬──────────────────────────────┤
│                                   │ Status / last move           │
│                                   ├──────────────────────────────┤
│          CHESS BOARD              │ Move history                 │
│       constrained by height       │ 1. e4    e5                  │
│                                   │ 2. Nf3   Nc6                 │
│                                   ├──────────────────────────────┤
│                                   │ Captures                     │
├───────────────────────────────────┤ [Resign]                     │
│ Self + clock                      │                              │
└───────────────────────────────────┴──────────────────────────────┘
```

### Desktop

```text
┌────┬─────────────────────────────────────────────────────────────────────────┐
│Logo│ Opponent identity                         Opponent clock   Connection   │
│    ├──────────────────────────────────────────────┬──────────────────────────┤
│Menu│                                              │ Game status              │
│    │                                              ├──────────────────────────┤
│    │                CHESS BOARD                   │ Move history             │
│    │             max by viewport height          │                          │
│    │                                              │ Auto-follow only when    │
│    │                                              │ user is already at end   │
│    │                                              ├──────────────────────────┤
│    ├──────────────────────────────────────────────┤ Captured pieces          │
│    │ Self identity                           Self │ [Resign]                 │
│    │                                          clock│                          │
└────┴──────────────────────────────────────────────┴──────────────────────────┘
```

Desktop board remains the largest object. The context panel is 320–360 px and
never forces the board below an accessible square size.

### Board keyboard interaction prototype

```text
Tab              → focus board entry square
Arrow keys       → move focus one file/rank in visual orientation
Home / End       → first/last square in current rank
Ctrl+Home / End  → first/last board square
Enter / Space    → select focused own piece or confirm legal target
Escape           → cancel selection/drag/promotion
Tab after board  → move history / game actions
```

Roving tabindex leaves one square in the tab order. Focus, selection, legal
target, last move, check, and pending are distinct visual/semantic states.

---

## `/learn`

### Mobile

```text
┌──────────────────────────────────────┐
│ Home / Learn                         │
│ Learn the pieces                     │
│ The rules, one clear idea at a time. │
│                                      │
│ ┌──────────┐ ┌──────────┐            │
│ │ KING     │ │ QUEEN    │            │
│ │ [art]    │ │ [art]    │            │
│ │ 5 min    │ │ 4 min    │            │
│ └──────────┘ └──────────┘            │
│ ┌──────────┐ ┌──────────┐            │
│ │ ROOK     │ │ BISHOP   │            │
│ └──────────┘ └──────────┘            │
│ ┌──────────┐ ┌──────────┐            │
│ │ KNIGHT   │ │ PAWN     │            │
│ └──────────┘ └──────────┘            │
└──────────────────────────────────────┘
```

### Desktop

```text
Intro occupies 4 columns; lesson grid occupies 8 columns.
Cards use piece silhouette, lesson title, one-sentence outcome, and link.
No progress percentage is shown until progress persistence exists.
```

---

## `/learn/[piece]`

### Mobile

```text
┌──────────────────────────────────────┐
│ Home / Learn / King                  │
│ [K] [Q] [R] [B] [N] [P]            │  Scrollable tablist
│                                      │
│              KING                    │  Display serif
│          [optimized hero art]        │
│                                      │
│ How the king moves                   │
│ One square in any direction.         │
│ It may not move into check.           │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Accessible example board        │ │
│ └──────────────────────────────────┘ │
│                                      │
│ [← Pawn]                 [Queen →]   │
└──────────────────────────────────────┘
```

The reference's horizontal piece rail is retained as a labeled tablist, not an
icon-only carousel. Content appears before decorative art when CSS/images fail.

### Desktop

```text
┌──────────────────────────────────────────────────────────────────┐
│ Piece rail / tabs                                                │
├───────────────────────────────┬──────────────────────────────────┤
│ Hero piece art                │ KING                             │
│                               │ How the king moves               │
│                               │ Rule copy                        │
│                               │ Accessible example board         │
│                               │ Previous / next                  │
└───────────────────────────────┴──────────────────────────────────┘
```

---

## `/settings`

### Mobile

```text
┌──────────────────────────────────────┐
│ Play / Settings                      │
│ Settings                             │
│                                      │
│ YOUR GUEST                           │
│ [Avatar] SilentKnight482             │
│ Expires in 11 hours                  │
│                                      │
│ BOARD                                │
│ Show coordinates          [on/off]   │
│ Input mode           [Tap and drag]  │
│                                      │
│ ACCESSIBILITY                        │
│ Reduce motion             [System ▾] │
│ Sound cues                    [off]   │
│                                      │
│ IDENTITY                             │
│ Guest identities cannot be recovered │
│ across devices or after expiry.      │
│ [Start with a new identity]          │  Destructive, separated
└──────────────────────────────────────┘
```

Reset confirmation:

```text
┌──────────────────────────────────────┐
│ Start with a new identity?           │
│ Your current generated name and      │
│ avatar cannot be recovered.          │
│                                      │
│ Active game variant:                 │
│ This immediately abandons your game. │
│                                      │
│ [Keep identity] [Reset identity]     │
└──────────────────────────────────────┘
```

## Layout approval checklist

- [x] Mobile landing CTA remains early and clear.
- [x] Lobby has no unsupported dashboard metrics.
- [x] Mobile board is the dominant object.
- [x] Desktop context panel does not compete with the board.
- [x] Active clocks remain visible through drawers/dialogs.
- [x] General mobile navigation is removed in live-game focus mode.
- [x] Learning retains the reference's piece navigation with labels and
      keyboard semantics.
- [x] Settings separates local preferences from destructive identity reset.
- [x] Every route includes loading, empty/error, and narrow-screen intent.
