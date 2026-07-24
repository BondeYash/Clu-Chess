# ADR 0004: History-aware chess-engine evaluation

- **Status:** Accepted
- **Date:** 2026-07-24
- **Gate:** D — Threefold repetition and engine history

## Context

The current FEN describes a position and its move counters, but it does not contain the full repetition history needed to adjudicate threefold repetition. A `gameStatus(fen)` API can therefore produce an incorrect result.

## Decision

The game service supplies the engine with the standard initial FEN, ordered persisted UCI moves, the expected current FEN, and the proposed move.

The domain-facing interface is:

```ts
export interface HistoricalMove {
  uci: string;
}

export interface EvaluateMoveInput {
  initialFen: string;
  history: readonly HistoricalMove[];
  expectedCurrentFen: string;
  move: MoveInput;
}

export interface MoveEvaluation {
  applied: AppliedMove;
  gameOver: GameOver;
  pgn: string;
}

export interface ReplayedPosition {
  fen: string;
  turn: 'w' | 'b';
  plyCount: number;
  pgn: string;
  gameOver: GameOver;
}

export interface ChessEngine {
  newGame(): ReplayedPosition;
  replay(
    initialFen: string,
    history: readonly HistoricalMove[],
  ): ReplayedPosition;
  evaluateMove(input: EvaluateMoveInput): MoveEvaluation;
}
```

The `chess.js` adapter:

1. loads `initialFen`;
2. replays ordered UCI history;
3. rejects stored illegal history as `GAME_STATE_CORRUPT`;
4. verifies the replayed FEN equals `expectedCurrentFen`;
5. validates and applies the proposal;
6. derives SAN, UCI, FEN, PGN, check, and every automatic terminal condition from the same engine instance.

`plyNumber` is `history.length + 1`. The move transaction queries history while holding the locked game view. Typical games have tens of plies, so deterministic replay is acceptable for the MVP. Optimization may add a checked snapshot later, but never at the expense of repetition correctness.

The domain imports only this interface. It never imports `chess.js`.

## Invariants

- Automatic draw detection uses authoritative ordered history.
- The replayed final FEN must match `games.current_fen`.
- A corrupt history fails closed; no move is accepted.
- PGN, FEN, and terminal status are derived from one replay/evaluation.

## Consequences

- The original FEN-only `gameStatus` contract is removed.
- Move processing reads ordered UCI history inside the game transaction.
- Engine version upgrades require the complete adapter conformance suite.

## Verification

- Threefold repetition tests use identical current positions with different histories and produce different outcomes.
- FEN/PGN round-trip tests replay all persisted moves.
- Tampered history/current-FEN mismatch rejects the proposal.
- Promotion, castling, en passant, mate, stalemate, insufficient material, and fifty-move behavior remain covered.
