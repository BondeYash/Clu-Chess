# CluChess Backend Documentation

| Document                                                 | Purpose                                             |
| -------------------------------------------------------- | --------------------------------------------------- |
| [`../Architecture.md`](../Architecture.md)               | Approved backend architecture v1.1                  |
| [`../PLAN.md`](../PLAN.md)                               | Phase-by-phase implementation and acceptance plan   |
| [`adr/`](adr/)                                           | Accepted architecture decision records              |
| [`protocol-v1.md`](protocol-v1.md)                       | Normative REST and Socket.IO v1 contract            |
| [`configuration.md`](configuration.md)                   | Zero-touch Docker and typed configuration contract  |
| [`database-operations.md`](database-operations.md)       | Roles, migrations, rollback, backup, and restore    |
| [`session-operations.md`](session-operations.md)         | Guest tokens, revocation, rotation, and retention   |
| [`realtime-operations.md`](realtime-operations.md)       | Socket transport, presence, scaling, and recovery   |
| [`game-domain.md`](game-domain.md)                       | Pure chess, lifecycle, outcome, and clock contracts |
| [`matchmaking-operations.md`](matchmaking-operations.md) | Queueing, allocation, rollback, and readiness       |
| [`gameplay-operations.md`](gameplay-operations.md)       | Authoritative moves, snapshots, and board endings   |

## Phase status

| Phase                                        | Status   |
| -------------------------------------------- | -------- |
| Phase 0 — Architecture closure and contracts | Complete |
| Phase 1 — Repository and runtime foundation  | Complete |
| Phase 2 — Durable persistence foundation     | Complete |
| Phase 3 — Anonymous identity and sessions    | Complete |
| Phase 4 — Realtime protocol and presence     | Complete |
| Phase 5 — Chess and game-domain core         | Complete |
| Phase 6 — Matchmaking and game allocation    | Complete |
| Phase 7 — Authoritative gameplay transaction | Complete |

Later phase documents and operational runbooks will be added here as they are completed.
