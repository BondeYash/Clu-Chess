# ADR F0006: Snapshot/event convergence and pending moves

- **Status:** Accepted
- **Date:** 2026-07-28
- **Owners:** Frontend and backend engineering

## Context

Socket.IO preserves order for delivered events but does not guarantee every
delivery. Acks and broadcasts may arrive in either order, lifecycle transitions
can advance version without a move, and a committed move can outlive its
broadcast.

## Decision

- Complete `game.snapshot` is the recovery authority.
- Incremental game events pass through one pure version-aware reducer.
- Deduplicate server events by bounded event-ID LRU and moves by authoritative
  `ply`.
- Ignore stale lower-version incremental events.
- Allow documented equal-version companion events.
- Apply exactly-next version events.
- On a version jump, stop incremental application and call `game.sync`.
- Discard an in-flight HTTP snapshot that is older than a higher version already
  applied, then sync again.
- A proposed move is only a pending visual overlay. It does not mutate
  authoritative FEN, history, clocks, or version.
- Retry missing acks with the same `eventId` and `clientMoveId`.
- After bounded uncertainty, sync before enabling another move.
- Client chess logic supplies hints only; it never decides result or flag fall.

## Rejected alternatives

- **Optimistically mutate the Query snapshot:** rejected because rollback and
  event reordering can corrupt the visible game.
- **Refetch after every event:** rejected due to avoidable latency/load.
- **Trust Socket.IO recovery alone:** rejected because PostgreSQL snapshot
  recovery is the backend guarantee.
- **Treat version as ply:** rejected because lifecycle transitions also advance
  version.

## Consequences

- The pending overlay gives immediate feedback without claiming acceptance.
- Reducer tests must cover ack/broadcast permutations and equal-version
  terminal companions.
- Normal readiness may trigger sync when an unobserved lifecycle version is
  skipped; correctness takes priority over avoiding one recovery read.

## Verification

- Contract tests exercise duplicate, stale, equal, next, and gapped versions.
- Lost ack/broadcast and process-crash tests converge on one snapshot.
- One proposal creates at most one confirmed visual move.
