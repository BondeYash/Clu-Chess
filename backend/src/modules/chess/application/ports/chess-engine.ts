export const CHESS_ENGINE = Symbol('CHESS_ENGINE');

export type ChessColor = 'b' | 'w';
export type PromotionPiece = 'b' | 'n' | 'q' | 'r';

export type MoveInput = Readonly<{
  from: string;
  promotion?: PromotionPiece;
  to: string;
}>;

export type AppliedMove = Readonly<{
  capture: boolean;
  check: boolean;
  color: ChessColor;
  fenAfter: string;
  fenBefore: string;
  plyNumber: number;
  san: string;
  uci: string;
}>;

export type ChessTermination =
  | 'checkmate'
  | 'fifty_move'
  | 'insufficient_material'
  | 'stalemate'
  | 'threefold_repetition';

export type GameOver =
  | Readonly<{ over: false }>
  | Readonly<{
      over: true;
      reason: ChessTermination;
      winner: ChessColor | null;
    }>;

export type HistoricalMove = Readonly<{
  uci: string;
}>;

export type EvaluateMoveInput = Readonly<{
  expectedCurrentFen: string;
  history: readonly HistoricalMove[];
  initialFen: string;
  move: MoveInput;
}>;

export type MoveEvaluation = Readonly<{
  applied: AppliedMove;
  gameOver: GameOver;
  pgn: string;
}>;

export type ReplayedPosition = Readonly<{
  fen: string;
  gameOver: GameOver;
  pgn: string;
  plyCount: number;
  turn: ChessColor;
}>;

export interface ChessEngine {
  evaluateMove(input: EvaluateMoveInput): MoveEvaluation;
  newGame(): ReplayedPosition;
  replay(
    initialFen: string,
    history: readonly HistoricalMove[],
  ): ReplayedPosition;
}
