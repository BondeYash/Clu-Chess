# Phase 0 Board Interaction Prototype

Open [`board-keyboard.html`](board-keyboard.html) directly in a browser.

## Purpose

This dependency-free prototype tests the accepted composite chessboard
interaction before the production component exists:

- one board stop in normal Tab order;
- roving square focus;
- arrow, Home, End, Ctrl+Home, and Ctrl+End navigation;
- Enter/Space selection and confirmation;
- Escape cancellation;
- visually and semantically separate selected, legal, and capture targets;
- polite status announcements;
- forced-colors fallback.

It intentionally does not implement chess legality, drag interaction, board
orientation, network commands, clocks, or production piece assets.

## Review tasks

1. Tab to the board and confirm focus begins on d4.
2. Move to all board edges with arrows; focus must not wrap or escape.
3. Press Enter on d4 and confirm the eight target states.
4. Move to f5 and confirm it is announced as a legal capture.
5. Press Enter and confirm the prototype move announcement.
6. Select d4 and press Escape.
7. Check forced-colors/high-contrast rendering.
8. Check 200% zoom and 320 px viewport width.

## Phase 0 engineering review

- [x] Interaction and announcement model matches the design specification.
- [x] Prototype is dependency-free and cannot mutate backend state.
- [x] Keyboard commands are documented beside the wireframes.
- [x] Forced-colors styles do not depend on the normal palette.
- [x] Headless Chrome creates 64 squares with exactly one square in the normal
      Tab order.
- [x] The 430 × 900 rendering was visually inspected for clipping, coordinate
      legibility, board priority, and content order.
- [ ] Formal assistive-technology user validation—scheduled when the production
      component exists in Phase 6.
