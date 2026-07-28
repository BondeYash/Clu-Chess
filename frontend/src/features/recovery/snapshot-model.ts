import type { GameSnapshot } from './game-recovery-types';
import type { PieceCode } from '@/components/chess/chess-piece';
import type { Square } from '@/components/chess/demo-chessboard';

const PIECES: Record<string, PieceCode> = {
  B: 'wb',
  K: 'wk',
  N: 'wn',
  P: 'wp',
  Q: 'wq',
  R: 'wr',
  b: 'bb',
  k: 'bk',
  n: 'bn',
  p: 'bp',
  q: 'bq',
  r: 'br',
};

export interface MoveRow {
  black?: string | undefined;
  number: number;
  white?: string | undefined;
}

export function parseFenPosition(
  fen: string,
): Partial<Record<Square, PieceCode>> {
  const ranks = fen.trim().split(/\s+/)[0]?.split('/');
  if (!ranks || ranks.length !== 8) {
    throw new Error('Snapshot FEN must contain eight ranks.');
  }

  const position: Partial<Record<Square, PieceCode>> = {};
  ranks.forEach((rank, rankIndex) => {
    let fileIndex = 0;
    for (const symbol of rank) {
      if (/^[1-8]$/.test(symbol)) {
        fileIndex += Number(symbol);
        continue;
      }
      const piece = PIECES[symbol];
      if (!piece || fileIndex > 7) {
        throw new Error('Snapshot FEN contains an unsupported piece layout.');
      }
      const square = `${String.fromCharCode(97 + fileIndex)}${
        8 - rankIndex
      }` as Square;
      position[square] = piece;
      fileIndex += 1;
    }
    if (fileIndex !== 8) {
      throw new Error('Snapshot FEN rank does not contain eight squares.');
    }
  });
  return position;
}

export function groupMoves(snapshot: GameSnapshot): MoveRow[] {
  const rows = new Map<number, MoveRow>();
  for (const move of snapshot.moves) {
    const number = Math.ceil(move.ply / 2);
    const row = rows.get(number) ?? { number };
    if (move.color === 'white') row.white = move.san;
    else row.black = move.san;
    rows.set(number, row);
  }
  return [...rows.values()];
}

export function formatClock(milliseconds: number): string {
  const bounded = Math.max(0, milliseconds);
  const totalSeconds = Math.ceil(bounded / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}`;
}

export function gameStatusLabel(status: GameSnapshot['status']): string {
  const labels: Record<GameSnapshot['status'], string> = {
    ABANDONED: 'Game abandoned',
    COMPLETED: 'Game complete',
    CREATED: 'Game created',
    EXPIRED: 'Game expired',
    IN_PROGRESS: 'Game in progress',
    READY: 'Players ready',
    RECONNECTING: 'Player reconnecting',
    WAITING_FOR_PLAYERS: 'Waiting for players',
  };
  return labels[status];
}

export function isTerminalSnapshot(snapshot: GameSnapshot): boolean {
  return ['ABANDONED', 'COMPLETED', 'EXPIRED'].includes(snapshot.status);
}
