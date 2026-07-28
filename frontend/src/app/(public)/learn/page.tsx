import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ChessPiece } from '@/components/chess/chess-piece';
import { Breadcrumbs, Card } from '@/components/ui';
import { LESSONS, PIECE_SLUGS } from '@/content/lessons';

export const metadata: Metadata = {
  title: 'Learn the pieces',
};

export default function LearnPage() {
  return (
    <div className="lesson-shell public-container">
      <Breadcrumbs items={[{ href: '/', label: 'Home' }, { label: 'Learn' }]} />
      <header className="page-heading">
        <p className="eyebrow">The essentials</p>
        <h1 className="display">Learn the pieces.</h1>
        <p>The rules, one clear idea at a time. No guest identity required.</p>
      </header>
      <div className="lesson-grid">
        {PIECE_SLUGS.map((slug) => {
          const lesson = LESSONS[slug];
          return (
            <Link
              className="lesson-card-link"
              href={`/learn/${slug}`}
              key={slug}
            >
              <Card as="article" variant="interactive">
                <ChessPiece piece={lesson.code} />
                <div>
                  <span className="eyebrow">{lesson.duration}</span>
                  <h2 className="display">{lesson.title}</h2>
                  <p>{lesson.description}</p>
                  <span className="lesson-card-link__action">
                    Open lesson
                    <ArrowRight aria-hidden="true" size={17} />
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
