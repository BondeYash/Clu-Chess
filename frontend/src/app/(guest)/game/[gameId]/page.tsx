import { Flag, ListOrdered } from 'lucide-react';
import { gameIdParameterSchema } from '@cluchess/protocol-v1/http';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DemoChessBoard } from '@/components/chess/demo-chessboard';
import { PlayerBar } from '@/components/game/player-bar';
import { Badge, Button } from '@/components/ui';
import { GameRecoveryScreen } from '@/features/recovery/game-recovery-screen';

export const metadata: Metadata = {
  title: 'Game',
};

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  if (gameId === 'demo') return <DemoGame />;
  if (!gameIdParameterSchema.safeParse(gameId).success) notFound();
  return <GameRecoveryScreen gameId={gameId} />;
}

function DemoGame() {
  return (
    <div className="game-layout">
      <div className="game-stage">
        <PlayerBar
          avatar="knight_black_01"
          clock="04:41"
          color="Black"
          name="NobleRook91"
        />
        <DemoChessBoard />
        <PlayerBar
          avatar="knight_amber_01"
          clock="04:52"
          color="White"
          currentTurn
          name="SilentKnight482"
          self
        />
      </div>
      <aside aria-label="Game details" className="game-context">
        <section className="game-context__section">
          <Badge tone="warning">Your turn</Badge>
          <h2 className="display">Find the quiet square.</h2>
          <p>
            This Phase 2 board is a typed fixture. Focus the board and use the
            arrow keys to explore its complete keyboard model.
          </p>
        </section>
        <section className="game-context__section">
          <h3>
            <ListOrdered aria-hidden="true" size={18} />
            Moves
          </h3>
          <ol className="move-list">
            <li>
              <span className="move-list__number">1.</span>
              <span>e4</span>
              <span>e5</span>
            </li>
            <li>
              <span className="move-list__number">2.</span>
              <span>Nf3</span>
              <span>Nc6</span>
            </li>
          </ol>
        </section>
        <div className="game-context__actions">
          <Button
            disabled
            title="Available when live gameplay is connected"
            variant="quiet"
          >
            <Flag aria-hidden="true" size={17} />
            Resign
          </Button>
          <p className="game-context__hint">
            Live actions remain disabled in this visual fixture.
          </p>
        </div>
      </aside>
    </div>
  );
}
