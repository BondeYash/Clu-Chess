# Phase 0 Acceptance Record

> **Phase:** Product, contract, and design closure
> **Status:** Accepted
> **Acceptance date:** 2026-07-28
> **Implementation scope:** Documentation, decisions, wireframes, and
> interaction specifications; no runtime mutation

## Objective evidence

| Requirement                               | Evidence                                                       | Result   |
| ----------------------------------------- | -------------------------------------------------------------- | -------- |
| Confirm screen inventory/non-goals        | [`product-scope.md`](product-scope.md)                         | Pass     |
| Same-origin topology ADR                  | [`adr/F0001`](adr/F0001-same-origin-production-topology.md)    | Accepted |
| Socket token strategy ADR                 | [`adr/F0002`](adr/F0002-session-token-storage.md)              | Accepted |
| Fetch abstraction ADR                     | [`adr/F0003`](adr/F0003-fetch-rest-abstraction.md)             | Accepted |
| Shared protocol ADR                       | [`adr/F0004`](adr/F0004-shared-protocol-package.md)            | Accepted |
| State ownership ADR                       | [`adr/F0005`](adr/F0005-state-ownership.md)                    | Accepted |
| Realtime reducer ADR                      | [`adr/F0006`](adr/F0006-realtime-convergence.md)               | Accepted |
| CSP/rendering ADR                         | [`adr/F0007`](adr/F0007-csp-and-rendering.md)                  | Accepted |
| Visual theme ADR                          | [`adr/F0008`](adr/F0008-visual-theme.md)                       | Accepted |
| Mobile/tablet/desktop wireframes          | [`wireframes.md`](wireframes.md)                               | Pass     |
| Bootstrap/queue/game/recovery/reset flows | [`user-flows.md`](user-flows.md)                               | Pass     |
| Frozen design tokens                      | [`design-system.md`](design-system.md)                         | Pass     |
| Component/state inventory                 | [`component-state-inventory.md`](component-state-inventory.md) | Pass     |
| Asset/license inventory                   | [`asset-register.md`](asset-register.md)                       | Pass     |
| Keyboard board prototype                  | [`prototypes/`](prototypes/)                                   | Pass     |
| Repeatable validation                     | [`validate-phase-0.mjs`](validate-phase-0.mjs)                 | Pass     |
| Endpoint/event screen ownership           | [`contract-coverage.md`](contract-coverage.md)                 | Pass     |
| Route/guard/navigation map                | [`route-map.md`](route-map.md)                                 | Pass     |

## Review results

### Reference-image review

- Retained board-first hierarchy, charcoal focus surface, editorial chess
  typography, mobile reachability, and piece-lesson navigation.
- Replaced cyan with copper/brass.
- Removed low-contrast text, live-board glow, icon-only primary navigation, and
  decorative 3D live pieces.
- Added mobile landscape, desktop context panel, keyboard, focus, loading,
  error, reconnect, and terminal specifications.

### Accessibility desk review

- Board is one composite grid with roving tabindex.
- Pointer, touch, and keyboard produce the same proposal.
- Focus, selection, legal target, capture target, last move, check, and pending
  are distinct.
- Clocks do not announce every tick.
- Dialog focus/restoration and 44 px targets are requirements.
- Narrow 320 px and 200% zoom behavior is specified.
- Representative task profiles reviewed: casual first-time player, returning
  guest, keyboard/screen-reader player, and learning visitor.

Formal usability sessions occur with the functional component in Phase 2/6;
Phase 0 does not claim observed human test results from a nonfunctional
wireframe.

The standalone prototype was rendered at 430 × 900 in headless Chrome. Its
generated DOM contained 64 squares and exactly one square in the normal Tab
order; the rendering was inspected for clipping and hierarchy.

### Token contrast

Automated calculations recorded in
[`design-system.md`](design-system.md) show all specified normal-text pairs at
or above 4.5:1. Board/state contrast receives browser-level validation in Phase 2.

### Contract inventory review

Validated against:

- [`../protocol-v1.md`](../protocol-v1.md);
- implemented session and recovery controllers;
- realtime protocol constants and schemas;
- game lifecycle/recovery operations.

Coverage:

- 9 HTTP routes;
- 7 client commands;
- 13 server events;
- 17 protocol error codes.

## Acceptance criteria

### Every backend endpoint/event has an owner and screen

- [x] HTTP owner matrix complete.
- [x] Client command owner matrix complete.
- [x] Server event owner matrix complete.
- [x] Infrastructure-only routes explicitly excluded from browser use.

### No unsupported role/dashboard/list feature remains implied

- [x] Product scope states one guest capability set.
- [x] Lobby is an action hub, not an analytics dashboard.
- [x] Pagination/filter/search/sort are marked not applicable.
- [x] No history, leaderboard, chat, draw offer, rematch, or spectator control
      appears in approved layouts.

### Security/storage and recovery decisions are explicit

- [x] Same-origin edge.
- [x] Per-tab token storage and cookie-backed renewal.
- [x] Strict client commands/tolerant server additions.
- [x] Snapshot/event convergence and same-ID retries.
- [x] Nonce CSP with accepted rendering cost.
- [x] Query/Zustand/URL/storage ownership.

### Mobile and desktop game layouts approved before high fidelity

- [x] Mobile portrait.
- [x] Mobile reconnect/result overlays.
- [x] Tablet landscape.
- [x] Desktop board/context layout.
- [x] Keyboard board interaction.
- [x] Focus-mode navigation.

## Phase gate

Phase 1 may begin. It must not reopen an accepted Phase 0 decision in code
review; a changed decision requires a superseding frontend ADR.
