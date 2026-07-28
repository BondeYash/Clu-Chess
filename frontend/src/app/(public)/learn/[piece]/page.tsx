import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DemoChessBoard } from '@/components/chess/demo-chessboard';
import { ChessPiece } from '@/components/chess/chess-piece';
import { PieceTabs } from '@/components/learning/piece-tabs';
import { Breadcrumbs, buttonClassName } from '@/components/ui';
import {
  isPieceSlug,
  LESSONS,
  PIECE_SLUGS,
  type PieceSlug,
} from '@/content/lessons';

export function generateStaticParams() {
  return PIECE_SLUGS.map((piece) => ({ piece }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ piece: string }>;
}): Promise<Metadata> {
  const { piece } = await params;
  return {
    title: isPieceSlug(piece) ? `Learn the ${piece}` : 'Lesson not found',
  };
}

export default async function PieceLessonPage({
  params,
}: {
  params: Promise<{ piece: string }>;
}) {
  const { piece } = await params;
  if (!isPieceSlug(piece)) notFound();
  const lesson = LESSONS[piece];
  const previous = LESSONS[lesson.previous];
  const next = LESSONS[lesson.next];

  return (
    <div className="lesson-shell public-container">
      <Breadcrumbs
        items={[
          { href: '/', label: 'Home' },
          { href: '/learn', label: 'Learn' },
          { label: lesson.title },
        ]}
      />
      <PieceTabs current={piece} />
      <div className="lesson-layout">
        <div className="lesson-art" aria-hidden="true">
          <ChessPiece piece={lesson.code} />
        </div>
        <article className="lesson-copy">
          <p className="eyebrow">{lesson.duration} lesson</p>
          <h1 className="display">{lesson.title}</h1>
          <h2>How the {piece} moves</h2>
          <p>{lesson.rule}</p>
          <p>{lesson.description}</p>
          <div className="example-board">
            <DemoChessBoard
              label={`Keyboard example for the ${piece}`}
              lastMove={[]}
              legalCaptures={[]}
              legalTargets={legalTargetsFor(piece)}
              position={{ e4: lesson.code }}
              selected="e4"
            />
          </div>
          <nav aria-label="Other lessons" className="lesson-pager">
            <Link
              className={buttonClassName({ variant: 'secondary' })}
              href={`/learn/${previous.slug}`}
            >
              <ArrowLeft aria-hidden="true" size={17} />
              {previous.title}
            </Link>
            <Link
              className={buttonClassName({ variant: 'secondary' })}
              href={`/learn/${next.slug}`}
            >
              {next.title}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </nav>
        </article>
      </div>
    </div>
  );
}

function legalTargetsFor(piece: PieceSlug) {
  if (piece === 'king')
    return ['d3', 'e3', 'f3', 'd4', 'f4', 'd5', 'e5', 'f5'] as const;
  if (piece === 'knight')
    return ['c3', 'c5', 'd2', 'd6', 'f2', 'f6', 'g3', 'g5'] as const;
  if (piece === 'pawn') return ['e5'] as const;
  if (piece === 'rook') return ['e2', 'e3', 'e5', 'e6', 'd4', 'f4'] as const;
  if (piece === 'bishop') return ['c2', 'd3', 'f5', 'g6'] as const;
  return ['e2', 'e3', 'e5', 'e6', 'd4', 'f4', 'd3', 'f5'] as const;
}
