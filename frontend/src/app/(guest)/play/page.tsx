import { ArrowRight, Clock3, Dices, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ChessPiece } from '@/components/chess/chess-piece';
import { Avatar, Badge, Card, buttonClassName } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Play',
};

export default function PlayPage() {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Ready when you are</p>
        <h1 className="display">Good evening, SilentKnight482.</h1>
        <p>
          Your fixture identity is ready. Live session and matchmaking wiring
          arrives in Phase 3 and 4.
        </p>
      </header>
      <div className="lobby-grid">
        <div>
          <Card as="section" aria-labelledby="guest-card-title">
            <div className="identity-card">
              <Avatar
                label="SilentKnight482 avatar"
                size="lg"
                value="knight_amber_01"
              />
              <div>
                <h2 id="guest-card-title">SilentKnight482</h2>
                <p>Amber knight · fixture identity</p>
              </div>
            </div>
          </Card>
          <Card as="article" className="learn-preview">
            <ChessPiece className="learn-preview__piece" piece="wn" />
            <div>
              <h3>Learn while you wait</h3>
              <p>Why the knight is the only piece that can jump.</p>
            </div>
            <Link
              className={buttonClassName({ variant: 'secondary' })}
              href="/learn/king"
            >
              Open lesson
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </Card>
        </div>
        <Card as="section" className="match-card" variant="inverse">
          <div className="match-card__header">
            <Badge tone="warning">Blitz</Badge>
            <span>One opponent</span>
          </div>
          <p className="match-card__time tabular">5 + 2</p>
          <p className="match-card__description">
            Five minutes each, with two seconds added after every confirmed
            move.
          </p>
          <div className="match-card__facts">
            <span>
              <Dices aria-hidden="true" size={17} />
              Random color
            </span>
            <span>
              <Clock3 aria-hidden="true" size={17} />
              Fast pairing
            </span>
            <span>
              <ShieldCheck aria-hidden="true" size={17} />
              Server checked
            </span>
          </div>
          <Link className={buttonClassName()} href="/game/demo">
            Preview a game
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </Card>
      </div>
    </>
  );
}
