# Frontend Architecture Decision Records

These ADRs are the accepted Phase 0 decisions for the CluChess frontend.
Frontend numbering is intentionally scoped to this directory and is independent
of [`../../adr/`](../../adr/), the backend ADR series.

| ADR                                               | Decision                                           |
| ------------------------------------------------- | -------------------------------------------------- |
| [F0001](F0001-same-origin-production-topology.md) | Same-origin production edge                        |
| [F0002](F0002-session-token-storage.md)           | Per-tab socket token storage and renewal           |
| [F0003](F0003-fetch-rest-abstraction.md)          | Native Fetch REST abstraction                      |
| [F0004](F0004-shared-protocol-package.md)         | Shared transport-only protocol package             |
| [F0005](F0005-state-ownership.md)                 | Query, Zustand, URL, and component state ownership |
| [F0006](F0006-realtime-convergence.md)            | Snapshot/event convergence and pending moves       |
| [F0007](F0007-csp-and-rendering.md)               | Nonce CSP and rendering tradeoff                   |
| [F0008](F0008-visual-theme.md)                    | One “Quiet Club” visual theme                      |

## Status values

- **Proposed:** open for review and not implementation authority.
- **Accepted:** required by the frontend implementation.
- **Superseded:** retained for history and replaced by a newer ADR.
