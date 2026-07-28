# CluChess Frontend Documentation

> **Phase 0 status:** Complete — accepted 2026-07-28
> **Phase 1 status:** Complete — accepted 2026-07-28
> **Master plan:** [`../../FRONTEND_PLAN.md`](../../FRONTEND_PLAN.md)
> **Backend contract:** [`../protocol-v1.md`](../protocol-v1.md)

This directory contains the implementation authority for the CluChess web
frontend. Phase 0 closed product scope and frontend decisions. Phase 1 added the
independently verified Next.js runtime and extracted the shared protocol
artifact without changing the backend's public wire contract.

## Phase 0 artifacts

| Artifact                                                       | Purpose                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`product-scope.md`](product-scope.md)                         | V1 users, screens, journeys, capabilities, and non-goals           |
| [`route-map.md`](route-map.md)                                 | Frozen public/guest routes, layouts, guards, and navigation        |
| [`user-flows.md`](user-flows.md)                               | Bootstrap, queue, gameplay, recovery, terminal, and reset flows    |
| [`wireframes.md`](wireframes.md)                               | Annotated mobile, tablet, and desktop low-fidelity layouts         |
| [`design-system.md`](design-system.md)                         | Frozen semantic tokens and board interaction specification         |
| [`component-state-inventory.md`](component-state-inventory.md) | Component hierarchy and required UI states                         |
| [`contract-coverage.md`](contract-coverage.md)                 | Screen ownership for every REST route and Socket.IO event          |
| [`asset-register.md`](asset-register.md)                       | Avatar, chess-piece, lesson-art, icon, font, and sound inventory   |
| [`prototypes/`](prototypes/)                                   | Dependency-free keyboard board interaction prototype               |
| [`phase-0-acceptance.md`](phase-0-acceptance.md)               | Evidence and acceptance checklist                                  |
| [`phase-1-acceptance.md`](phase-1-acceptance.md)               | Runtime, contract, container, Compose, and regression evidence      |
| [`validate-phase-0.mjs`](validate-phase-0.mjs)                 | Repeatable artifact, contract, link, contrast, and prototype check |
| [`adr/`](adr/)                                                 | Accepted frontend architecture decision records                    |

## Authority and change control

The precedence order for frontend implementation is:

1. backend runtime contract in [`../protocol-v1.md`](../protocol-v1.md);
2. accepted backend ADRs in [`../adr/`](../adr/);
3. accepted frontend ADRs in [`adr/`](adr/);
4. this Phase 0 artifact set;
5. the roadmap in [`../../FRONTEND_PLAN.md`](../../FRONTEND_PLAN.md).

If a frontend document conflicts with the backend wire contract, the backend
contract wins and the frontend document must be corrected. Changing an accepted
frontend decision requires a new ADR that names the superseded decision and
updates affected artifacts and tests.

## Validate Phase 0

From the repository root:

```bash
node docs/frontend/validate-phase-0.mjs
```
