# Chess and Game-Domain Core

Phase 5 provides deterministic building blocks for later transactional game
commands. The code in this phase does not read a clock, database, Redis key, or
socket on its own.

## Boundaries

- `chess/application/ports/chess-engine.ts` is the only chess contract consumed
  by application code.
- `chess/infrastructure/chessjs.engine.ts` is the only production source file
  that imports `chess.js`.
- `game/domain/` contains transport- and persistence-independent lifecycle,
  terminal-result, clock, player, move, and snapshot types.
- `CHESS_ENGINE` is exported by `ChessModule` for dependency injection without
  exposing vendor types.

## Historical chess evaluation

Every evaluation starts from `initialFen`, replays the ordered persisted UCI
history, verifies the resulting FEN against `expectedCurrentFen`, and applies
the proposed move to that same engine instance. This is required for
threefold-repetition detection.

Failures are normalized:

| Code                       | Meaning                                                 |
| -------------------------- | ------------------------------------------------------- |
| `ILLEGAL_MOVE`             | The client proposal is malformed or illegal             |
| `INVALID_INITIAL_POSITION` | Server configuration supplied an invalid initial FEN    |
| `GAME_STATE_CORRUPT`       | Persisted history is illegal or disagrees with the game |

The adapter returns only CluChess types: canonical SAN and UCI, before/after
FEN, capture/check flags, ply number, PGN, turn, and automatic terminal status.

## Lifecycle and versions

The state machine is an explicit transition table. Allocation creates
`WAITING_FOR_PLAYERS` at version 0. Every later durable, externally visible
transition increments the game version exactly once. A terminal accepted move
also increments once for the combined move and result. Ply remains independent
from game version.

Terminal outcomes are derived centrally from board status or the losing/absent
players. Clients never supply a result. Contradictory outcomes and illegal
state edges fail with stable game-domain error codes.

## Clock rules

Clock functions accept explicit server timestamps and never call `Date.now()`.
They calculate:

- live snapshot values without mutating persisted state;
- elapsed deduction and post-move increment;
- exact-zero and overdue flag fall;
- explicit pause/resume for lifecycle policies;
- the next advisory deadline.

Disconnect handling must not call `pauseClock`; clocks continue while a game is
`RECONNECTING`. The PostgreSQL transaction in a later phase supplies the
authoritative admission timestamp and decides which returned clock state is
persisted.

## Verification

Unit conformance covers all legal and forbidden lifecycle edges, frozen
terminal outcomes, promotions to all four pieces, castling, en passant, check,
mate, stalemate, insufficient material, threefold repetition, the fifty-move
rule, FEN/PGN replay, corruption handling, increments, pause/resume, reconnect
time, delayed handlers, and exact-zero flag fall. Clock tests use fake server
time and no sleeps.
