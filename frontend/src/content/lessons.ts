import type { PieceCode } from '@/components/chess/chess-piece';

export const PIECE_SLUGS = [
  'king',
  'queen',
  'rook',
  'bishop',
  'knight',
  'pawn',
] as const;

export type PieceSlug = (typeof PIECE_SLUGS)[number];

export interface Lesson {
  code: PieceCode;
  description: string;
  duration: string;
  next: PieceSlug;
  previous: PieceSlug;
  rule: string;
  slug: PieceSlug;
  title: string;
}

export const LESSONS: Record<PieceSlug, Lesson> = {
  bishop: {
    code: 'wb',
    description:
      'Bishops stay on one colour and travel as far as the board allows.',
    duration: '4 min',
    next: 'knight',
    previous: 'rook',
    rule: 'Move any number of clear squares diagonally.',
    slug: 'bishop',
    title: 'Bishop',
  },
  king: {
    code: 'wk',
    description:
      'The king is the piece every plan protects. It moves carefully, one square at a time.',
    duration: '5 min',
    next: 'queen',
    previous: 'pawn',
    rule: 'Move one square in any direction, but never into check.',
    slug: 'king',
    title: 'King',
  },
  knight: {
    code: 'wn',
    description:
      'Knights bend the geometry of the board and can jump over every piece.',
    duration: '5 min',
    next: 'pawn',
    previous: 'bishop',
    rule: 'Move two squares in one direction, then one square to the side.',
    slug: 'knight',
    title: 'Knight',
  },
  pawn: {
    code: 'wp',
    description:
      'Pawns move forward, capture diagonally, and can become something greater.',
    duration: '6 min',
    next: 'king',
    previous: 'knight',
    rule: 'Move forward one square and capture one square diagonally.',
    slug: 'pawn',
    title: 'Pawn',
  },
  queen: {
    code: 'wq',
    description:
      'The queen combines long straight lines with sweeping diagonals.',
    duration: '4 min',
    next: 'rook',
    previous: 'king',
    rule: 'Move any number of clear squares in any direction.',
    slug: 'queen',
    title: 'Queen',
  },
  rook: {
    code: 'wr',
    description:
      'Rooks command open ranks and files with direct, deliberate movement.',
    duration: '4 min',
    next: 'bishop',
    previous: 'queen',
    rule: 'Move any number of clear squares horizontally or vertically.',
    slug: 'rook',
    title: 'Rook',
  },
};

export function isPieceSlug(value: string): value is PieceSlug {
  return PIECE_SLUGS.includes(value as PieceSlug);
}
