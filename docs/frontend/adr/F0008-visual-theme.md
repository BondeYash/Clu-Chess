# ADR F0008: One “Quiet Club” visual theme

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Product design and frontend engineering

## Context

The references combine charcoal panels, pale canvas, classical type, 3D chess
pieces, and cyan selection. The product requirement rejects generic
blue/purple/neon AI aesthetics and prioritizes readability and trust.

## Decision

Ship one deliberate visual system in v1: **The Quiet Club**.

- warm parchment canvas;
- ink/charcoal focus surfaces;
- oxidized copper primary action/focus;
- muted sage board squares/status;
- brass selection/earned emphasis;
- Cormorant Garamond for restrained display use;
- Manrope for UI, text, and tabular clocks;
- flat carved SVG pieces for live play;
- richer raster illustrations only for learning/editorial heroes;
- thin keylines and restrained shadows;
- no decorative gradient, glow, parallax, or particle layer.

No user-selectable light/dark themes ship in v1. Forced-colors, high contrast,
and reduced motion remain supported accessibility modes rather than visual
themes.

## Rejected alternatives

- **Copy the cyan/blur reference literally:** rejected for brand differentiation
  and contrast.
- **Generic SaaS/AI gradient system:** rejected by product direction.
- **Photoreal 3D live pieces:** rejected due to silhouette, performance, and
  state-legibility risk.
- **Multiple themes in v1:** rejected because it doubles board/state/accessibility
  qualification.

## Consequences

- Semantic tokens are frozen in [`../design-system.md`](../design-system.md).
- Asset art direction and UI states share one recognizable visual language.
- A future theme requires a new decision and full board/state regression suite.

## Verification

- Token contrast meets WCAG 2.2 AA.
- Visual review finds no blue/purple/neon or generic gradient treatment.
- Live board states remain distinguishable at small sizes, high zoom, reduced
  motion, and forced colors.
