# CluChess Design System Specification

> **Status:** Frozen Phase 0 tokens and behavior
> **Theme:** The Quiet Club
> **Accessibility target:** WCAG 2.2 AA

## Design principles

1. The board is the visual priority during play.
2. Warm material cues create character; effects never reduce legibility.
3. One accent communicates action and focus.
4. Chess heritage appears in editorial moments, not dense UI.
5. State is expressed with text/shape/icon as well as color.
6. Mobile, keyboard, reduced-motion, and high-zoom behavior are designed states.

## Color tokens

Components consume semantic tokens only. Tailwind exposes these through theme
variables; raw colors must not appear in feature components.

| Token                     | Value     | Role                         | Required pairing            |
| ------------------------- | --------- | ---------------------------- | --------------------------- |
| `--color-canvas`          | `#F3F0E8` | Page background              | `ink`, `ink-muted`          |
| `--color-canvas-strong`   | `#E7E0D2` | Secondary canvas/light board | `ink`                       |
| `--color-surface`         | `#FFFFFF` | Cards, menus, dialogs        | `ink`, `ink-muted`          |
| `--color-surface-inverse` | `#262B27` | Game rail/focus surface      | `ink-inverse`               |
| `--color-ink`             | `#1C211E` | Primary text/icons           | Light surfaces              |
| `--color-ink-muted`       | `#5C625C` | Secondary text               | `canvas`/`surface`          |
| `--color-ink-inverse`     | `#F7F3EA` | Text on inverse              | `surface-inverse`           |
| `--color-line`            | `#D4CCBD` | Borders/dividers             | Decorative boundary only    |
| `--color-accent`          | `#A65335` | Primary action/focus         | White or canvas             |
| `--color-accent-strong`   | `#7B3D28` | Pressed/destructive emphasis | White                       |
| `--color-sage`            | `#6D7763` | Dark board/neutral status    | White/ink by measured state |
| `--color-brass`           | `#D7B46A` | Selection/earned emphasis    | Ink                         |
| `--color-danger`          | `#9A3F32` | Destructive/critical         | White plus icon/text        |
| `--color-success`         | `#4F6B50` | Connected/success            | White plus label/icon       |
| `--color-focus-ring`      | `#A65335` | Focus-visible outline        | 2 px with 2 px offset       |

### Verified contrast pairs

| Foreground / background |   Ratio | Result         |
| ----------------------- | ------: | -------------- |
| `ink` / `canvas`        | 14.34:1 | AAA            |
| `ink-muted` / `canvas`  |  5.49:1 | AA normal text |
| white / `accent`        |  5.37:1 | AA normal text |
| white / `accent-strong` |  8.27:1 | AAA            |
| `ink` / `brass`         |  8.27:1 | AAA            |
| `ink` / `canvas-strong` | 12.44:1 | AAA            |
| white / `sage`          |  4.70:1 | AA normal text |

Contrast validation must run again after browser rendering and antialiasing. A
border token is not accepted as the only separator for critical controls.

### Color prohibitions

- No blue, purple, or neon accent.
- No decorative gradient in the core app.
- No glow around the board, clocks, or controls.
- No low-opacity text below contrast requirements.
- No connection, urgency, legality, or result state encoded only with color.

## Typography

### Families

| Token            | Family             | Weights            | License     | Use                          |
| ---------------- | ------------------ | ------------------ | ----------- | ---------------------------- |
| `--font-display` | Cormorant Garamond | 500, 600           | SIL OFL 1.1 | Hero, lesson/result headings |
| `--font-ui`      | Manrope            | 400, 500, 600, 700 | SIL OFL 1.1 | UI, copy, controls, clocks   |

Both are self-hosted through `next/font`; no runtime Google Fonts request.

### Type scale

| Token        | Mobile | Desktop | Line height | Use               |
| ------------ | -----: | ------: | ----------: | ----------------- |
| `display-xl` |  48 px |   72 px |        0.95 | Landing hero only |
| `display-lg` |  40 px |   56 px |         1.0 | Lesson/result     |
| `heading-xl` |  30 px |   40 px |        1.15 | Page title        |
| `heading-lg` |  24 px |   30 px |         1.2 | Section           |
| `heading-md` |  20 px |   22 px |         1.3 | Card              |
| `body-lg`    |  18 px |   18 px |        1.55 | Intro             |
| `body`       |  16 px |   16 px |        1.55 | Default           |
| `body-sm`    |  14 px |   14 px |        1.45 | Supporting        |
| `label`      |  13 px |   13 px |         1.3 | Compact control   |
| `clock`      |  30 px |   42 px |         1.0 | Player clocks     |

Rules:

- Body copy is never display serif.
- All-caps is limited to short labels with tracked spacing.
- Clocks and move numbers use tabular numerals.
- User-generated content does not exist in v1; generated guest names still
  truncate safely with full name available to assistive tech/tooltip.

## Spacing and layout

### Spacing scale

`4, 8, 12, 16, 24, 32, 48, 64, 96 px`

### Containers

| Token             | Intent                                    |
| ----------------- | ----------------------------------------- |
| `content-reading` | 68 characters                             |
| `content-form`    | 640 px                                    |
| `content-app`     | 1280 px                                   |
| `game-context`    | 320–360 px                                |
| `public-gutter`   | 16 px mobile, 24 px tablet, 32 px desktop |

### Responsive breakpoints

Viewport breakpoints organize navigation; game layout also uses container
queries.

| Name | Minimum | Intent                         |
| ---- | ------: | ------------------------------ |
| `sm` |  480 px | Larger phone                   |
| `md` |  768 px | Tablet                         |
| `lg` | 1024 px | Tablet landscape/small desktop |
| `xl` | 1280 px | Full desktop                   |

Do not write device-specific CSS. Test 320 px width and zoom behavior between
breakpoints.

## Shape, border, and elevation

| Token            | Value                              | Use                    |
| ---------------- | ---------------------------------- | ---------------------- |
| `radius-control` | 12 px                              | Buttons, fields        |
| `radius-card`    | 16 px                              | Normal cards           |
| `radius-feature` | 24 px                              | Hero/match card        |
| `radius-board`   | 12 px mobile / 18 px desktop       | Board frame            |
| `border-default` | 1 px `line`                        | Cards/fields           |
| `focus-default`  | 2 px `focus-ring`, 2 px offset     | All focusable controls |
| `shadow-1`       | `0 1px 2px rgb(28 33 30 / 0.06)`   | Subtle card            |
| `shadow-2`       | `0 12px 32px rgb(28 33 30 / 0.10)` | Floating panel         |
| `shadow-dialog`  | `0 24px 64px rgb(28 33 30 / 0.18)` | Dialog/sheet           |

Critical game surfaces are opaque. Backdrop blur may decorate a noncritical
hero but must have an opaque fallback.

## Control contracts

### Button

- Minimum height 44 px; primary action 48 px.
- Variants: primary, secondary, quiet, destructive.
- States: rest, hover, focus-visible, active, disabled, pending.
- Pending retains label width and adds a text alternative.
- Disabled controls expose a nearby reason when the state is not obvious.

### Icon button

- Minimum 44 × 44 px.
- Requires accessible name and tooltip where the icon has no adjacent label.
- Never used as the only primary action on the lobby.

### Field

- Persistent visible label.
- Helper/error area reserves space where layout shift would be disruptive.
- Invalid state includes text and icon, not border color only.
- No placeholder-only labels.

### Dialog/sheet

- Initial focus on heading or safest action.
- Focus trap and restoration.
- Escape closes nonblocking dialogs.
- Destructive confirmations default focus to cancel.
- Promotion dialog is modal to board input but does not obscure both clocks.

## Motion tokens

| Token            | Duration | Use                      |
| ---------------- | -------: | ------------------------ |
| `motion-instant` |   120 ms | Hover/focus feedback     |
| `motion-control` |   200 ms | Button/state transition  |
| `motion-panel`   |   280 ms | Drawer/dialog            |
| `motion-piece`   |   180 ms | Confirmed piece movement |

Easing:

- standard: `cubic-bezier(0.2, 0, 0, 1)`;
- exit: `cubic-bezier(0.4, 0, 1, 1)`.

Reduced motion:

- piece changes are immediate;
- panels fade without travel;
- queue animation becomes a static/progress text state;
- no content depends on transition completion.

## Chessboard visual specification

### Board palette

| State              | Visual                                 | Non-color equivalent                |
| ------------------ | -------------------------------------- | ----------------------------------- |
| Light square       | `canvas-strong`                        | Coordinate label                    |
| Dark square        | `sage`                                 | Coordinate label                    |
| Focused            | 2 px inset focus ring                  | `aria-current`-like announced focus |
| Selected source    | Copper outline + corner marks          | Announced “selected”                |
| Legal empty target | Centered 18% dot                       | Announced “legal target”            |
| Legal capture      | Inset corner brackets                  | Announced “legal capture”           |
| Last move          | Thin brass edge on source/target       | Move list current marker            |
| Check              | Danger corner wedge + king outline     | Announced “king in check”           |
| Pending            | Brass diagonal hatch/opacity           | Status “submitting…”                |
| Drag source        | Piece ghost plus retained square focus | Keyboard selection equivalent       |

### Piece art

- Flat local SVG with a carved chess-club character.
- Distinct silhouettes at 32 px.
- White pieces use warm ivory with dark outline.
- Black pieces use ink with light/keyline detail.
- State is applied to square/layer, not by recoloring piece identity.

### Coordinates

- Visible by default.
- Correct for current visual orientation.
- Do not reduce piece hit area.
- Can be disabled as a local preference.

## Board interaction prototype

### Pointer/touch

1. Tap/click own piece to select.
2. Tap/click legal target to propose.
3. Tapping another own piece changes selection.
4. Tapping outside/cancel clears selection.
5. Drag starts after movement threshold; dropping outside cancels.
6. Promotion opens a four-option dialog before command creation.

### Keyboard

| Key                  | Behavior                                  |
| -------------------- | ----------------------------------------- |
| Arrow keys           | Move focus one visual square              |
| Home / End           | First/last square of visual rank          |
| Ctrl+Home / Ctrl+End | First/last square of board                |
| Enter / Space        | Select or confirm                         |
| Escape               | Cancel selection/drag/promotion           |
| Tab                  | Enter/leave board as one composite widget |

The DOM/API design uses a grid with roving tabindex, not 64 sequential tab
stops.

### Announcements

- Focused square: coordinate, piece/color or empty.
- Selection: selected piece and number of legal targets.
- Confirmed move: SAN and check when supplied by server.
- Rejection: mapped human reason.
- Clock: announce only threshold changes, never every tick.

## Status language

| Technical state       | Primary copy                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| socket connecting     | Connecting…                                                             |
| socket recovering     | Reconnecting… Your last confirmed position is safe.                     |
| queued                | Finding a player…                                                       |
| match found           | Opponent found                                                          |
| waiting for player    | Waiting for your opponent                                               |
| pending move          | Submitting {move}…                                                      |
| version sync          | Updating the board…                                                     |
| opponent disconnected | Opponent disconnected. Their clock continues.                           |
| rate limited          | Please wait {duration} before trying again.                             |
| service unavailable   | CluChess is temporarily unavailable. Your confirmed game state is safe. |

## Empty, loading, error, and success patterns

- **Loading:** geometry-matched skeleton plus concise label after 1 second.
- **Empty:** explain why there is no data and show one next action.
- **Error:** plain-language cause category, safe retained data, primary recovery,
  optional correlation reference.
- **Success:** prefer persistent state change over toast. Toast only for copied
  PGN or saved local preference.

## Design acceptance

- [x] Semantic color/type/spacing/shape/motion tokens frozen.
- [x] All specified text contrast pairs meet AA.
- [x] Board focus, selection, legality, check, pending, and last-move states are
      visually and semantically distinct.
- [x] Keyboard interaction is specified without requiring drag.
- [x] The visual identity avoids blue/purple/neon and decorative gradients.
- [x] One theme limits v1 qualification surface.
