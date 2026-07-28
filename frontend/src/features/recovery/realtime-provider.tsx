'use client';

import type {
  ClientReceivedRealtimeAck,
  ClientReceivedServerEventEnvelope,
} from '@cluchess/protocol-v1/realtime';
import { gameIdParameterSchema } from '@cluchess/protocol-v1/http';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';

import {
  useGuestSession,
  type GuestSessionContextValue,
} from '@/features/session/session-provider';
import { sessionApi } from '@/features/session/session-api';
import type { SessionBootstrapResult } from '@/features/session/session-coordinator';
import { sessionStorageAdapter } from '@/features/session/session-storage';
import { queryKeys } from '@/lib/query-keys';
import { realtimeClient } from '@/services/realtime/realtime-client';
import { fromProtocolError } from '@/services/realtime/realtime-error';
import { transportStore, useTransportStore } from '@/stores/transport-store';

import { gameRecoveryApi } from './game-recovery-api';
import type { GameSnapshot } from './game-recovery-types';
import { RealtimeContext } from './realtime-context';
import { isTerminalSnapshot } from './snapshot-model';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const session = useGuestSession();
  const queryClient = useQueryClient();
  const pathname = usePathname() ?? '/';
  const routeGameId = pathname.startsWith('/game/')
    ? pathname.slice('/game/'.length)
    : null;
  const realtimeRequired =
    routeGameId !== null &&
    gameIdParameterSchema.safeParse(routeGameId).success;
  const connectionEpoch = useTransportStore((state) => state.connectionEpoch);
  const authenticationIssue = useTransportStore(
    (state) => state.issue?.code === 'UNAUTHORIZED',
  );
  const ready = readySession(session);
  const sessionRef = useRef(session);

  const recover = useCallback(
    async () => recoverAuthoritativeState(queryClient, sessionRef.current),
    [queryClient],
  );
  const retryConnection = useCallback(async () => {
    const ready = readySession(sessionRef.current);
    const token = sessionStorageAdapter.getToken();
    if (!ready || !token) return;
    await realtimeClient.connect({ identityId: ready.guest.id, token });
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const unsubscribe = realtimeClient.subscribe((event) => {
      void handleServerEvent(event, queryClient, sessionRef.current);
    });
    return unsubscribe;
  }, [queryClient]);

  useEffect(() => {
    const token = sessionStorageAdapter.getToken();
    if (!realtimeRequired || !ready || !token) {
      realtimeClient.disconnect();
      return;
    }
    void realtimeClient
      .connect({ identityId: ready.guest.id, token })
      .catch((error: unknown) => {
        transportStore.issue({
          code: 'CONNECTION_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'The realtime connection could not be started.',
          retryable: true,
        });
        transportStore.status('unavailable');
      });
  }, [ready, realtimeRequired]);

  useEffect(() => {
    if (connectionEpoch === 0) return;
    void recover();
  }, [connectionEpoch, recover]);

  useEffect(() => {
    if (!authenticationIssue) return;
    const ready = readySession(sessionRef.current);
    if (!ready) return;
    void import('@/features/session/session-coordinator')
      .then(async ({ sessionCoordinator }) => {
        const next = await sessionCoordinator.renewReadySession(ready);
        queryClient.setQueriesData<SessionBootstrapResult>(
          { queryKey: queryKeys.session.all },
          next,
        );
        if (next.status === 'ready') {
          transportStore.clearIssue();
        }
      })
      .catch(() => {
        transportStore.issue({
          code: 'SESSION_RENEWAL_FAILED',
          message:
            'This guest identity could not be renewed. The last confirmed board remains available.',
          retryable: true,
        });
        transportStore.status('unavailable');
      });
  }, [authenticationIssue, queryClient]);

  useEffect(
    () => () => {
      realtimeClient.disconnect();
    },
    [],
  );

  return (
    <RealtimeContext.Provider value={{ recover, retryConnection }}>
      {children}
    </RealtimeContext.Provider>
  );
}

async function recoverAuthoritativeState(
  queryClient: QueryClient,
  session: GuestSessionContextValue,
): Promise<void> {
  const ready = readySession(session);
  const token = sessionStorageAdapter.getToken();
  if (!ready || !token) return;

  try {
    const knownSnapshot = ready.activeGameId
      ? queryClient.getQueryData<GameSnapshot>(
          queryKeys.games.snapshot(ready.activeGameId),
        )
      : undefined;
    const ack = await realtimeClient.emitCommand(
      'game.sync',
      ready.activeGameId
        ? {
            gameId: ready.activeGameId,
            ...(knownSnapshot
              ? { gameVersion: knownSnapshot.gameVersion }
              : {}),
            payload: {},
          }
        : { payload: {} },
    );
    await handleAck(ack, queryClient, session);
    transportStore.clearIssue();
    return;
  } catch {
    // HTTP is the independent recovery path when the socket cannot confirm.
  }

  try {
    const active = await sessionApi.getActive(token);
    updateActiveGame(queryClient, active.gameId);
    if (active.gameId) {
      const snapshot = await gameRecoveryApi.getSnapshot(active.gameId, token);
      publishSnapshot(queryClient, snapshot);
    }
    transportStore.clearIssue();
  } catch (error) {
    transportStore.issue({
      code: 'RECOVERY_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'Authoritative game recovery could not be completed.',
      retryable: true,
    });
  }
}

async function handleServerEvent(
  event: ClientReceivedServerEventEnvelope,
  queryClient: QueryClient,
  session: GuestSessionContextValue,
): Promise<void> {
  if (event.type === 'session.ready') {
    await reconcileSessionReady(event.payload, queryClient, session);
    return;
  }
  if (event.type === 'game.snapshot') {
    publishSnapshot(queryClient, {
      ...event.payload,
      correlationId: event.correlationId,
      gameId: event.gameId,
      gameVersion: event.gameVersion,
    });
    return;
  }
  if (
    'gameId' in event &&
    event.gameId &&
    event.type !== 'match.found' &&
    event.type !== 'move.rejected'
  ) {
    await recoverGame(event.gameId, queryClient);
    return;
  }
  if (
    (event.type === 'server.error' || event.type === 'move.rejected') &&
    event.payload.code === 'STALE_GAME_VERSION'
  ) {
    await recoverAuthoritativeState(queryClient, session);
  }
}

async function handleAck(
  ack: ClientReceivedRealtimeAck,
  queryClient: QueryClient,
  session: GuestSessionContextValue,
): Promise<void> {
  if (!ack.ok) {
    throw fromProtocolError(ack.error, ack.correlationId);
  }
  if (ack.type === 'session.ready') {
    await reconcileSessionReady(ack.payload, queryClient, session);
  }
  if (ack.type === 'game.snapshot') {
    if (typeof ack.gameVersion !== 'number') {
      throw new Error('Snapshot acknowledgement omitted its game version.');
    }
    let activeGameId =
      readySession(session)?.activeGameId ??
      sessionStorageAdapter.getActiveGameHint();
    if (!activeGameId) {
      const token = sessionStorageAdapter.getToken();
      if (token) {
        activeGameId = (await sessionApi.getActive(token)).gameId;
      }
    }
    if (activeGameId) {
      publishSnapshot(queryClient, {
        ...ack.payload,
        correlationId: ack.correlationId,
        gameId: activeGameId,
        gameVersion: ack.gameVersion,
      });
    }
  }
}

async function reconcileSessionReady(
  payload: Extract<
    ClientReceivedServerEventEnvelope,
    { type: 'session.ready' }
  >['payload'],
  queryClient: QueryClient,
  session: GuestSessionContextValue,
): Promise<void> {
  const ready = readySession(session);
  const token = sessionStorageAdapter.getToken();
  if (!ready || !token) return;
  if (payload.guest.id !== ready.guest.id) {
    queryClient.setQueriesData<SessionBootstrapResult>(
      { queryKey: queryKeys.session.all },
      (current) =>
        current?.status === 'ready'
          ? { activeGameId: ready.activeGameId, status: 'identity-lost' }
          : current,
    );
    realtimeClient.disconnect();
    return;
  }

  try {
    const active = await sessionApi.getActive(token);
    updateActiveGame(queryClient, active.gameId, payload.guest);
    if (active.gameId && active.gameId !== payload.activeGameId) {
      await recoverGame(active.gameId, queryClient);
    }
  } catch {
    updateActiveGame(queryClient, payload.activeGameId, payload.guest);
  }
}

async function recoverGame(
  gameId: string,
  queryClient: QueryClient,
): Promise<void> {
  const token = sessionStorageAdapter.getToken();
  if (!token) return;
  try {
    const snapshot = await gameRecoveryApi.getSnapshot(gameId, token);
    publishSnapshot(queryClient, snapshot);
  } catch {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.games.snapshot(gameId),
    });
  }
}

function publishSnapshot(
  queryClient: QueryClient,
  snapshot: GameSnapshot,
): void {
  queryClient.setQueryData(queryKeys.games.snapshot(snapshot.gameId), snapshot);
  const activeGameId = isTerminalSnapshot(snapshot) ? null : snapshot.gameId;
  updateActiveGame(queryClient, activeGameId);
}

function updateActiveGame(
  queryClient: QueryClient,
  activeGameId: string | null,
  guest?: {
    avatar: string;
    expiresAt: string;
    id: string;
    name: string;
  },
): void {
  sessionStorageAdapter.setActiveGameHint(activeGameId);
  queryClient.setQueriesData<SessionBootstrapResult>(
    { queryKey: queryKeys.session.all },
    (current) => {
      if (!current || current.status !== 'ready') return current;
      return {
        ...current,
        activeGameId,
        activeGameStatus: 'available',
        guest: guest ? { ...current.guest, ...guest } : current.guest,
      };
    },
  );
}

function readySession(
  session: GuestSessionContextValue,
): Extract<SessionBootstrapResult, { status: 'ready' }> | undefined {
  return session.view.status === 'ready' ? session.view : undefined;
}
