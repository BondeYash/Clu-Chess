# ADR F0005: Query, Zustand, URL, and component state ownership

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Frontend engineering

## Context

CluChess combines REST snapshots, realtime events, high-frequency clock
display, route identity, pending commands, and durable local preferences. A
single global store would duplicate server state and create unclear ownership.

## Decision

- **TanStack Query:** guest, active-game ID, and authoritative game snapshot.
- **Zustand/external store:** transport status, queue coordination, clock offset,
  and small cross-route UI preferences.
- **URL:** game ID, lesson piece, and shareable settings subsection.
- **React component state/reducers:** square selection, hover/drag, promotion
  dialog, drawer state, and other local interaction.
- **`sessionStorage`:** per-tab socket token, queue intent, and identifiers for
  uncertain in-flight commands.
- **`localStorage`:** schema-versioned non-sensitive preferences only.

The Query game cache is updated by the realtime reducer. A full game is never
copied into Zustand, and Query persistence is disabled for guest/game data.

## Rejected alternatives

- **All Zustand:** rejected because it recreates caching, request deduplication,
  and invalidation.
- **All React Context:** rejected due to high-frequency broad rerenders.
- **Persisted Query cache:** rejected because stale guest/game state can outlive
  identity and protocol context.
- **URL for transient queue/game state:** rejected because it is neither secure
  nor authoritative.

## Consequences

- Ownership is discoverable and testable.
- Identity reset must clear several scoped owners through one coordinator.
- High-frequency clock ticks stay isolated from the Query/game object.

## Verification

- Architecture lint prevents feature stores from importing whole Query models.
- Reset/identity-change tests clear all guest-scoped owners.
- Clock tests show no board rerender per tick.
