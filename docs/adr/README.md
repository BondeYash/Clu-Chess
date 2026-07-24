# Architecture Decision Records

Phase 0 decisions are normative for implementation. If an ADR conflicts with older prose in `Architecture.md`, the accepted ADR and the Phase 0 clarification section in `Architecture.md` take precedence.

| ADR                                                     | Decision                                       |
| ------------------------------------------------------- | ---------------------------------------------- |
| [0001](0001-postgresql-active-game-assignments.md)      | PostgreSQL-backed active-game assignments      |
| [0002](0002-idempotent-match-allocation.md)             | Crash-safe and idempotent match allocation     |
| [0003](0003-durable-server-clocks.md)                   | Durable server-authoritative clocks            |
| [0004](0004-history-aware-chess-engine.md)              | History-aware chess-engine evaluation          |
| [0005](0005-session-token-lifecycle.md)                 | Session renewal, idempotency, and revocation   |
| [0006](0006-game-transitions-and-terminal-races.md)     | Game transitions, versions, and terminal races |
| [0007](0007-leaderless-background-jobs.md)              | Leaderless, idempotent background jobs         |
| [0008](0008-versioned-protocol-and-acknowledgements.md) | Strict protocol and acknowledgements           |

## Status values

- **Proposed:** under discussion; not implementation authority.
- **Accepted:** approved and required.
- **Superseded:** retained for history but replaced by a later ADR.

Changing an accepted decision requires a new ADR that names the superseded record and updates the architecture, protocol, plan, migrations, and affected tests.
