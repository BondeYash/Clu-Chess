import { classNames } from '@/lib/class-names';

export type PieceColor = 'black' | 'white';
export type PieceKind =
  'bishop' | 'king' | 'knight' | 'pawn' | 'queen' | 'rook';
export type PieceCode = `${'b' | 'w'}${'b' | 'k' | 'n' | 'p' | 'q' | 'r'}`;

const PIECE_KIND: Record<PieceCode, PieceKind> = {
  bb: 'bishop',
  bk: 'king',
  bn: 'knight',
  bp: 'pawn',
  bq: 'queen',
  br: 'rook',
  wb: 'bishop',
  wk: 'king',
  wn: 'knight',
  wp: 'pawn',
  wq: 'queen',
  wr: 'rook',
};

export function describePiece(piece: PieceCode): string {
  const color: PieceColor = piece.startsWith('w') ? 'white' : 'black';
  return `${color} ${PIECE_KIND[piece]}`;
}

export function ChessPiece({
  className,
  piece,
}: {
  className?: string;
  piece: PieceCode;
}) {
  const color: PieceColor = piece.startsWith('w') ? 'white' : 'black';
  const kind = PIECE_KIND[piece];

  return (
    <svg
      aria-hidden="true"
      className={classNames('chess-piece', `chess-piece--${color}`, className)}
      focusable="false"
      viewBox="0 0 64 64"
    >
      <use href={`/chess-pieces/pieces.svg#${kind}`} />
    </svg>
  );
}
