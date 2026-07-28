import Link from 'next/link';

import { ChessPiece } from '@/components/chess/chess-piece';
import { LESSONS, PIECE_SLUGS, type PieceSlug } from '@/content/lessons';

export function PieceTabs({ current }: { current: PieceSlug }) {
  return (
    <nav aria-label="Chess piece lessons">
      <div className="piece-tabs" role="tablist">
        {PIECE_SLUGS.map((slug) => {
          const lesson = LESSONS[slug];
          const selected = current === slug;
          return (
            <Link
              aria-selected={selected}
              className="piece-tab"
              href={`/learn/${slug}`}
              key={slug}
              role="tab"
            >
              <ChessPiece piece={lesson.code} />
              <span>{lesson.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
