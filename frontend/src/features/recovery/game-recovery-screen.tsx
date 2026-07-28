'use client';

import { Flag, ListOrdered, RefreshCw, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { DemoChessBoard } from '@/components/chess/demo-chessboard';
import { PlayerBar } from '@/components/game/player-bar';
import {
  Badge,
  Button,
  FeedbackState,
  Skeleton,
  buttonClassName,
} from '@/components/ui';
import { useGuestSession } from '@/features/session/session-provider';
import { sessionStorageAdapter } from '@/features/session/session-storage';
import { isApiError } from '@/lib/api/api-error';
import { queryKeys } from '@/lib/query-keys';
import {
  transportStore,
  useTransportStore,
  type TransportStatus,
} from '@/stores/transport-store';

import { gameRecoveryApi } from './game-recovery-api';
import type { GameSnapshot } from './game-recovery-types';
import { useRealtime } from './realtime-context';
import {
  formatClock,
  gameStatusLabel,
  groupMoves,
  parseFenPosition,
} from './snapshot-model';

export function GameRecoveryScreen({ gameId }: { gameId: string }) {
  const { view } = useGuestSession();
  const { recover } = useRealtime();
  const transportStatus = useTransportStore((state) => state.status);
  const snapshotQuery = useQuery<GameSnapshot>({
    enabled: view.status === 'ready',
    queryFn: async () => {
      const token = sessionStorageAdapter.getToken();
      if (!token) throw new Error('Guest identity proof is unavailable.');
      return gameRecoveryApi.getSnapshot(gameId, token);
    },
    queryKey: queryKeys.games.snapshot(gameId),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  if (snapshotQuery.isPending) return <RecoverySkeleton />;
  if (snapshotQuery.isError) {
    const privateFailure =
      isApiError(snapshotQuery.error) &&
      (snapshotQuery.error.status === 403 ||
        snapshotQuery.error.status === 404 ||
        snapshotQuery.error.code === 'GAME_NOT_FOUND' ||
        snapshotQuery.error.code === 'NOT_A_PLAYER');
    if (privateFailure) {
      const activeGameId = view.status === 'ready' ? view.activeGameId : null;
      return (
        <FeedbackState
          kind="error"
          size="route"
          title="This game is not available to this guest"
        >
          <p>
            The link may belong to another temporary identity or may no longer
            be available. No player or game details were disclosed.
          </p>
          {activeGameId && activeGameId !== gameId ? (
            <Link
              className={buttonClassName({ variant: 'secondary' })}
              href={`/game/${activeGameId}`}
            >
              Open your active game
            </Link>
          ) : null}
        </FeedbackState>
      );
    }
    return (
      <FeedbackState
        actionLabel="Try recovery again"
        {...(isApiError(snapshotQuery.error) &&
        snapshotQuery.error.correlationId
          ? { correlationId: snapshotQuery.error.correlationId }
          : {})}
        kind="offline"
        onAction={() => void snapshotQuery.refetch()}
        size="route"
        title="The board could not be recovered"
      >
        <p>
          The last safe board will remain cached if one exists. Retry when the
          service is reachable.
        </p>
      </FeedbackState>
    );
  }

  return (
    <RecoveredGame
      onRecover={recover}
      snapshot={snapshotQuery.data}
      transportStatus={transportStatus}
    />
  );
}

function RecoveredGame({
  onRecover,
  snapshot,
  transportStatus,
}: {
  onRecover(): Promise<void>;
  snapshot: GameSnapshot;
  transportStatus: TransportStatus;
}) {
  const [recoveryPending, setRecoveryPending] = useState(false);
  const position = useMemo(() => {
    try {
      return parseFenPosition(snapshot.currentFen);
    } catch {
      return null;
    }
  }, [snapshot.currentFen]);
  const moves = useMemo(() => groupMoves(snapshot), [snapshot]);
  if (!position) {
    return (
      <FeedbackState
        actionLabel="Request a fresh snapshot"
        kind="error"
        onAction={() => void onRecover()}
        size="route"
        title="The recovered board could not be verified"
      >
        <p>
          CluChess will not render an uncertain position. Request another
          authoritative snapshot before continuing.
        </p>
      </FeedbackState>
    );
  }

  const white =
    snapshot.you.color === 'white' ? snapshot.you : snapshot.opponent;
  const black =
    snapshot.you.color === 'black' ? snapshot.you : snapshot.opponent;
  const top = snapshot.you.color === 'white' ? black : white;
  const bottom = snapshot.you.color === 'white' ? white : black;
  const topClock =
    top.color === 'white' ? snapshot.clocks.whiteMs : snapshot.clocks.blackMs;
  const bottomClock =
    bottom.color === 'white'
      ? snapshot.clocks.whiteMs
      : snapshot.clocks.blackMs;

  async function recover() {
    if (recoveryPending) return;
    setRecoveryPending(true);
    try {
      await onRecover();
    } catch {
      transportStore.issue({
        code: 'RECOVERY_FAILED',
        message: 'Authoritative game recovery could not be completed.',
        retryable: true,
      });
    } finally {
      setRecoveryPending(false);
    }
  }

  return (
    <div className="game-layout game-layout--recovery">
      <div className="game-stage">
        <PlayerBar
          avatar={top.avatar}
          clock={formatClock(topClock)}
          color={top.color === 'white' ? 'White' : 'Black'}
          connected={top.connected}
          currentTurn={snapshot.clocks.running === top.color}
          name={top.name}
          self={top === snapshot.you}
        />
        <DemoChessBoard
          label={`Recovered game board, ${snapshot.you.color} orientation`}
          lastMove={[]}
          legalCaptures={[]}
          legalTargets={[]}
          orientation={snapshot.you.color}
          position={position}
          readOnly
          selected={null}
        />
        <PlayerBar
          avatar={bottom.avatar}
          clock={formatClock(bottomClock)}
          color={bottom.color === 'white' ? 'White' : 'Black'}
          connected={bottom.connected}
          currentTurn={snapshot.clocks.running === bottom.color}
          name={bottom.name}
          self={bottom === snapshot.you}
        />
      </div>
      <aside
        aria-label="Recovered game details"
        className="game-context game-context--recovery"
      >
        <section className="game-context__section game-recovery-summary">
          <div className="game-recovery-summary__badges">
            <Badge tone={snapshot.result ? 'neutral' : 'warning'}>
              {gameStatusLabel(snapshot.status)}
            </Badge>
            <Badge tone="neutral">Version {snapshot.gameVersion}</Badge>
          </div>
          <h2 className="display">
            {snapshot.result
              ? 'The record is complete.'
              : 'Your board is safe.'}
          </h2>
          <p>
            {transportStatus === 'connected'
              ? 'This position is authoritative and live recovery is connected.'
              : 'This is the last confirmed server snapshot. It remains visible while live updates reconnect.'}
          </p>
        </section>
        <section className="game-context__section game-moves">
          <h3>
            <ListOrdered aria-hidden="true" size={18} />
            Moves
          </h3>
          {moves.length ? (
            <div
              aria-label="Move history"
              className="move-scroll"
              role="region"
              tabIndex={0}
            >
              <ol className="move-list">
                {moves.map((move) => (
                  <li key={move.number}>
                    <span className="move-list__number">{move.number}.</span>
                    <span>{move.white ?? '—'}</span>
                    <span>{move.black ?? '—'}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p>No moves have been confirmed yet.</p>
          )}
        </section>
        <div className="game-context__actions">
          <Button
            onClick={() => void recover()}
            pending={recoveryPending}
            pendingLabel="Refreshing safe position…"
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" size={17} />
            Refresh safe position
          </Button>
          <Button
            disabled
            title="Resignation is enabled in the gameplay phase"
            variant="quiet"
          >
            <Flag aria-hidden="true" size={17} />
            Resign
          </Button>
          <p className="game-context__hint">
            <ShieldCheck aria-hidden="true" size={16} />
            Move input stays locked until the gameplay phase. Recovery never
            guesses a position.
          </p>
        </div>
      </aside>
    </div>
  );
}

function RecoverySkeleton() {
  return (
    <div
      aria-label="Recovering the authoritative game"
      className="game-layout game-layout--recovery"
    >
      <div className="game-stage">
        <Skeleton variant="player" />
        <Skeleton variant="board" />
        <Skeleton variant="player" />
      </div>
      <aside className="game-recovery-skeleton">
        <Skeleton variant="text" />
        <Skeleton variant="card" />
      </aside>
    </div>
  );
}
