# CluChess Documentation

| Document                                                       | Purpose                                             |
| -------------------------------------------------------------- | --------------------------------------------------- |
| [`../Architecture.md`](../Architecture.md)                     | Approved backend architecture v1.1                  |
| [`../PLAN.md`](../PLAN.md)                                     | Phase-by-phase implementation and acceptance plan   |
| [`adr/`](adr/)                                                 | Accepted architecture decision records              |
| [`protocol-v1.md`](protocol-v1.md)                             | Normative REST and Socket.IO v1 contract            |
| [`configuration.md`](configuration.md)                         | Zero-touch Docker and typed configuration contract  |
| [`database-operations.md`](database-operations.md)             | Roles, migrations, rollback, backup, and restore    |
| [`session-operations.md`](session-operations.md)               | Guest tokens, revocation, rotation, and retention   |
| [`realtime-operations.md`](realtime-operations.md)             | Socket transport, presence, scaling, and recovery   |
| [`game-domain.md`](game-domain.md)                             | Pure chess, lifecycle, outcome, and clock contracts |
| [`matchmaking-operations.md`](matchmaking-operations.md)       | Queueing, allocation, rollback, and readiness       |
| [`gameplay-operations.md`](gameplay-operations.md)             | Authoritative moves, snapshots, and board endings   |
| [`game-lifecycle-operations.md`](game-lifecycle-operations.md) | Deadlines, absence, and non-move endings            |
| [`recovery-operations.md`](recovery-operations.md)             | Recovery, reconciliation, and dependency failures   |
| [`scaling-operations.md`](scaling-operations.md)               | Multi-replica routing, drain, and datastore scaling |
| [`security-operations.md`](security-operations.md)             | Boundary, secret, datastore, and scanning controls  |
| [`observability-operations.md`](observability-operations.md)   | Metrics, traces, dashboards, alerts, and capacity   |
| [`observability-runbooks.md`](observability-runbooks.md)       | Alert response and escalation procedures            |
| [`qualification-operations.md`](qualification-operations.md)   | E2E, failure, load, audit, and evidence gates       |
| [`qualification-exceptions.md`](qualification-exceptions.md)   | Release qualification exception register            |
| [`frontend/`](frontend/)                                       | Frontend architecture and phase acceptance records   |

## Phase status

| Phase                                           | Status                                      |
| ----------------------------------------------- | ------------------------------------------- |
| Phase 0 — Architecture closure and contracts    | Complete                                    |
| Phase 1 — Repository and runtime foundation     | Complete                                    |
| Phase 2 — Durable persistence foundation        | Complete                                    |
| Phase 3 — Anonymous identity and sessions       | Complete                                    |
| Phase 4 — Realtime protocol and presence        | Complete                                    |
| Phase 5 — Chess and game-domain core            | Complete                                    |
| Phase 6 — Matchmaking and game allocation       | Complete                                    |
| Phase 7 — Authoritative gameplay transaction    | Complete                                    |
| Phase 8 — Clocks and non-move terminal paths    | Complete                                    |
| Phase 9 — Recovery and dependency failure       | Complete                                    |
| Phase 10 — Multi-instance and graceful delivery | Complete                                    |
| Phase 11 — Security and observability hardening | Complete                                    |
| Phase 12 — E2E, failure, and load qualification | Implemented; release-scale evidence pending |

Phase 12's repeatable harness and CI smoke are complete. Release-scale target,
stress, burst, and soak artifacts remain candidate-specific evidence and are
not inferred from the smoke profile.
