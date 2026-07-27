export const GAME_STATUSES = [
  'CREATED',
  'WAITING_FOR_PLAYERS',
  'READY',
  'IN_PROGRESS',
  'RECONNECTING',
  'COMPLETED',
  'ABANDONED',
  'EXPIRED',
] as const;

export type GameStatus = (typeof GAME_STATUSES)[number];
export type PlayerColor = 'b' | 'w';
export type GameResult = 'black_win' | 'draw' | 'void' | 'white_win';
export type BoardTermination =
  | 'checkmate'
  | 'fifty_move'
  | 'insufficient_material'
  | 'stalemate'
  | 'threefold_repetition';
export type GameTermination =
  | 'abandonment'
  | BoardTermination
  | 'double_abandon'
  | 'no_show'
  | 'resignation'
  | 'timeout';

export type GamePlayer = Readonly<{
  color: PlayerColor;
  connected: boolean;
  guestSessionId: string;
  joinedAt: Date | null;
  slot: 0 | 1;
}>;

export type GameMove = Readonly<{
  clientMoveId: string;
  color: PlayerColor;
  fenAfter: string;
  fenBefore: string;
  guestSessionId: string;
  ply: number;
  san: string;
  serverReceivedAt: Date;
  uci: string;
}>;

export type GameClockSnapshot = Readonly<{
  blackMs: number;
  observedAt: Date;
  running: PlayerColor | null;
  whiteMs: number;
}>;

export type GameState = Readonly<{
  currentFen: string;
  id: string;
  initialFen: string;
  matchId: string;
  pgn: string;
  result: GameResult | null;
  status: GameStatus;
  termination: GameTermination | null;
  turn: PlayerColor;
  version: number;
}>;

export type GameSnapshot = Readonly<{
  clocks: GameClockSnapshot;
  game: GameState;
  moves: readonly GameMove[];
  players: readonly [GamePlayer, GamePlayer];
}>;

export function oppositeColor(color: PlayerColor): PlayerColor {
  return color === 'w' ? 'b' : 'w';
}
