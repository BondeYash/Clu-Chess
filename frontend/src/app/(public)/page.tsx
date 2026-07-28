import { ArrowRight, ShieldCheck, TimerReset, UserRoundX } from 'lucide-react';
import Link from 'next/link';

import { ChessPiece } from '@/components/chess/chess-piece';
import { buttonClassName } from '@/components/ui/button';

const PRINCIPLES = [
  {
    description:
      'A generated name and knight are ready when you choose to play.',
    icon: UserRoundX,
    title: 'Anonymous by design',
  },
  {
    description:
      'Every move and clock decision is confirmed by the authoritative server.',
    icon: ShieldCheck,
    title: 'The board stays honest',
  },
  {
    description:
      'A refresh or brief disconnect returns to the last confirmed position.',
    icon: TimerReset,
    title: 'Built to reconnect',
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="hero public-container" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">One board. One honest contest.</p>
          <h1 className="display" id="hero-title">
            A quieter way to play.
          </h1>
          <p className="hero__summary">
            Instant 5+2 chess with no account ceremony. Find one opponent, focus
            on the board, and return safely if your connection stumbles.
          </p>
          <div className="hero__actions">
            <Link className={buttonClassName()} href="/play">
              Find a match
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              className={buttonClassName({ variant: 'secondary' })}
              href="/learn/king"
            >
              Learn the pieces
            </Link>
          </div>
          <div className="hero__trust" aria-label="Product principles">
            <span>Anonymous</span>
            <span>Server-authoritative</span>
            <span>Reconnectable</span>
          </div>
        </div>
        <div className="hero-art" aria-label="Editorial knight and board study">
          <p className="hero-art__note">
            Five minutes.
            <br />
            Two-second increment.
          </p>
          <div aria-hidden="true" className="hero-art__board">
            {Array.from({ length: 16 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
          <ChessPiece className="hero-art__piece" piece="wn" />
        </div>
      </section>
      <section
        aria-labelledby="principles-heading"
        className="principles public-container"
      >
        <h2 className="sr-only" id="principles-heading">
          How CluChess works
        </h2>
        {PRINCIPLES.map((principle, index) => {
          const Icon = principle.icon;
          return (
            <article className="principle" key={principle.title}>
              <div className="principle__number">
                <Icon aria-hidden="true" size={27} />
                <span className="sr-only">Step {index + 1}</span>
              </div>
              <h2>{principle.title}</h2>
              <p>{principle.description}</p>
            </article>
          );
        })}
      </section>
    </>
  );
}
