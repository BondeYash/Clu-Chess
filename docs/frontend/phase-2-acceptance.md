# Frontend Phase 2 Acceptance

> **Status:** Accepted
> **Date:** 2026-07-28
> **Roadmap:** [`../../FRONTEND_PLAN.md`](../../FRONTEND_PLAN.md)

## Delivered visual system

- Semantic canvas, surface, ink, copper, sage, brass, danger, success, spacing,
  type, radius, shadow, focus, and motion tokens are implemented without
  blue/purple/neon or decorative gradient treatment.
- Manrope UI text and Cormorant Garamond editorial display text use
  `next/font`, reserve layout space, and are self-hosted by the Next build.
- The component catalog includes buttons, icon buttons, cards, badges, avatars,
  fields, selects, switches, breadcrumbs, loading skeletons, feedback states,
  toasts, tooltips, dialog, and drawer states. Storybook builds with
  documentation and accessibility addons.
- The public shell has a skip link, compact header, primary navigation, footer,
  and legal routes. The guest shell has a desktop rail, compact application
  header, responsive mobile navigation, focus-mode game treatment, connection
  state, and fixture identity.
- The optimized same-origin SVG asset set includes the brand mark, wordmark,
  favicon, and reusable chess-piece symbol sprite. The eight accepted avatar
  keys map to deterministic local knight treatments; unknown keys never become
  arbitrary image URLs.
- Responsive layouts include safe-area padding, container-aware game
  composition, narrow-phone reflow, and explicit reduced-motion and
  forced-colour behavior.

## Delivered fixture routes

| Route                                  | Phase 2 experience                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                                    | Editorial landing page, product promise, CTAs, and trust principles                         |
| `/play`                                | Guest identity, learning prompt, and fixed 5+2 match card                                   |
| `/game/demo`                           | Responsive game shell, players, clocks, keyboard board, move list, and disabled live action |
| `/learn`                               | Piece lesson index                                                                          |
| `/learn/[piece]`                       | Six statically generated piece lessons with board examples and adjacent navigation          |
| `/settings`                            | Interactive board/accessibility preferences and destructive confirmation fixture            |
| `/privacy`, `/terms`, `/accessibility` | Public content-shell and breadcrumb coverage                                                |

All route data is typed local fixture data. Phase 2 performs no session, game,
or preference API mutation.

## Board interaction contract

- The board exposes one labelled ARIA grid, eight rows, and 64 grid cells.
- Exactly one square participates in the normal Tab order.
- Arrow keys move one square, Home/End move within a rank,
  Control+Home/Control+End move to board bounds, Enter/Space selects, and
  Escape clears selection.
- Selection, legal target, legal capture, last move, check, and pending move use
  shape/border treatment and accessible text in addition to colour.
- White and black orientation, coordinate labels, read-only lesson boards, and
  mobile pointer activation use the same component.

## Acceptance evidence

| Gate                                                | Result                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Formatting, ESLint, strict TypeScript, typed routes | Pass                                                                                                                          |
| Static asset policy                                 | 5 same-origin SVG files passed extension, size, script, remote-reference, and data-URI validation                             |
| Unit/component/contract suite                       | 5 files, 21 tests passed                                                                                                      |
| Frontend coverage                                   | 94.47% statements, 84.32% branches, 98.03% functions, 97.43% lines                                                            |
| Storybook production catalog                        | Storybook 10.5.5 built successfully with docs and a11y addons                                                                 |
| Next production build                               | 17 static/SSG pages generated; typed dynamic game route compiled                                                              |
| Chromium E2E                                        | 14 tests passed                                                                                                               |
| Automated accessibility                             | Zero WCAG 2 A/AA violations on `/`, `/play`, `/game/demo`, `/learn/king`, and `/settings`                                     |
| Responsive visual regression                        | Approved screenshots at 320, 390, 768, 1024, and 1440 px                                                                      |
| Keyboard board                                      | Browser and component suites passed roving focus, boundaries, selection, and clearing                                         |
| Mobile targets                                      | Board cells measured at least 32 px at 390 px; primary controls measured at least 44 px                                       |
| Reflow                                              | `/settings` remained operable at 200% zoom with no horizontal document overflow                                               |
| Alternate presentation                              | Forced colours preserved board state; reduced-motion media behavior was active                                                |
| Layout stability                                    | Font/image loading stayed within the 0.1 cumulative layout-shift budget                                                       |
| Local demonstration                                 | Compose frontend is live at `http://localhost:5173`; backend remains separate at `http://localhost:3300` for this workstation |

The visual baselines are stored beside
[`phase-2.spec.ts`](../../frontend/test/e2e/phase-2.spec.ts). They are generated
with animations disabled and the Next development indicator disabled so only
product UI participates in comparisons.

## Acceptance criteria

- [x] Every core primitive state is represented in the Storybook catalog.
- [x] The implementation uses the accepted warm editorial palette and contains
      no blue/purple/neon or generic decorative gradient treatment.
- [x] Public and guest routes remain keyboard-operable and reflow at 200%.
- [x] The board meets composite-widget keyboard, target-size, non-colour-state,
      orientation, and responsive-layout requirements.
- [x] Empty, success, offline, error, loading, disabled, pending, and destructive
      patterns are reusable outside feature routes.
- [x] Asset licenses and same-origin validation are recorded in
      [`../../frontend/LICENSES.md`](../../frontend/LICENSES.md).

Phase 3 may now connect the REST foundation and anonymous session lifecycle to
these accepted visual and interaction contracts.
