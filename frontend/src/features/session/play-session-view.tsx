'use client';

import {
  ArrowRight,
  Clock3,
  Dices,
  ShieldCheck,
  ShieldEllipsis,
} from 'lucide-react';
import Link from 'next/link';

import { ChessPiece } from '@/components/chess/chess-piece';
import { Avatar, Badge, Card, buttonClassName } from '@/components/ui';

import { useGuestSession } from './session-provider';

export function PlaySessionView() {
  const { view } = useGuestSession();
  if (view.status !== 'ready') return null;
  const { activeGameId, guest } = view;

  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Ready when you are</p>
        <h1 className="display">Good evening, {guest.name}.</h1>
        <p>
          Your temporary guest is protected by this browser session until{' '}
          <time dateTime={guest.expiresAt}>
            {formatExpiry(guest.expiresAt)}
          </time>
          .
        </p>
      </header>
      {activeGameId ? (
        <Card as="section" className="active-game-notice" variant="interactive">
          <ShieldEllipsis aria-hidden="true" size={24} />
          <div>
            <h2>Active game protected</h2>
            <p>
              CluChess found an active assignment for this identity. Session
              expiry will never replace it with a new guest; full board recovery
              connects in Phase 4.
            </p>
          </div>
        </Card>
      ) : null}
      <div className="lobby-grid">
        <div>
          <Card as="section" aria-labelledby="guest-card-title">
            <div className="identity-card">
              <Avatar
                label={`${guest.name} avatar`}
                size="lg"
                value={guest.avatar}
              />
              <div>
                <h2 id="guest-card-title">{guest.name}</h2>
                <p>Temporary guest · stored only for this tab</p>
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

function formatExpiry(expiresAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(expiresAt));
}
