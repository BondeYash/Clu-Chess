import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GuestSessionProvider,
  useGuestSession,
} from '@/features/session/session-provider';
import { sessionStorageAdapter } from '@/features/session/session-storage';
import { createQueryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { transportStore, useTransportStore } from '@/stores/transport-store';

import type { GameSnapshot } from './game-recovery-types';
import { useRealtime } from './realtime-context';
import { RealtimeProvider } from './realtime-provider';

const navigation = vi.hoisted(() => ({
  pathname: '/play',
}));
const coordinatorMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  renewalDelay: vi.fn(),
  renewReadySession: vi.fn(),
  resetAndCreate: vi.fn(),
}));
const realtimeMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  emitCommand: vi.fn(),
  listener: undefined as ((event: unknown) => void) | undefined,
  subscribe: vi.fn((listener: (event: unknown) => void) => {
    realtimeMock.listener = listener;
    return vi.fn();
  }),
}));
const sessionApiMock = vi.hoisted(() => ({
  getActive: vi.fn(),
}));
const recoveryApiMock = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock('@/features/session/session-coordinator', () => ({
  sessionCoordinator: coordinatorMock,
}));
vi.mock('@/features/session/session-api', () => ({
  sessionApi: sessionApiMock,
}));
vi.mock('@/services/realtime/realtime-client', () => ({
  realtimeClient: realtimeMock,
}));
vi.mock('./game-recovery-api', () => ({
  gameRecoveryApi: recoveryApiMock,
}));

const guestId = '11111111-1111-4111-8111-111111111111';
const activeGameId = '22222222-2222-4222-8222-222222222222';
const disagreementId = '33333333-3333-4333-8333-333333333333';

describe('RealtimeProvider', () => {
  beforeEach(() => {
    navigation.pathname = '/play';
    sessionStorageAdapter.clearAll();
    sessionStorageAdapter.setToken('private-token');
    transportStore.reset();
    realtimeMock.connect.mockReset().mockResolvedValue(undefined);
    realtimeMock.disconnect.mockReset();
    realtimeMock.emitCommand
      .mockReset()
      .mockRejectedValue(new Error('offline'));
    realtimeMock.listener = undefined;
    realtimeMock.subscribe.mockClear();
    sessionApiMock.getActive.mockReset().mockResolvedValue({
      correlationId: '44444444-4444-4444-8444-444444444444',
      gameId: activeGameId,
    });
    recoveryApiMock.getSnapshot.mockReset().mockResolvedValue(snapshot());
    coordinatorMock.bootstrap.mockReset().mockResolvedValue(ready());
    coordinatorMock.renewalDelay.mockReset().mockReturnValue(null);
    coordinatorMock.renewReadySession.mockReset().mockResolvedValue(ready());
    coordinatorMock.resetAndCreate.mockReset().mockResolvedValue(ready());
  });

  it('keeps the socket bundle deferred outside a real game route', async () => {
    renderRealtime();

    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('ready'),
    );
    expect(realtimeMock.connect).not.toHaveBeenCalled();
  });

  it('connects once for a UUID game and recovers through HTTP after sync failure', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    const queryClient = createQueryClient();
    renderRealtime(queryClient);

    await waitFor(() => expect(realtimeMock.connect).toHaveBeenCalledOnce());
    act(() => transportStore.connected());

    await waitFor(() =>
      expect(recoveryApiMock.getSnapshot).toHaveBeenCalledWith(
        activeGameId,
        'private-token',
      ),
    );
    expect(
      queryClient.getQueryData(queryKeys.games.snapshot(activeGameId)),
    ).toMatchObject({ gameId: activeGameId, gameVersion: 7 });
  });

  it('reconciles a socket disagreement against the independent active lookup', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    const queryClient = createQueryClient();
    renderRealtime(queryClient);
    await waitFor(() => expect(realtimeMock.listener).toBeTypeOf('function'));
    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('ready'),
    );

    act(() => {
      realtimeMock.listener?.(sessionReadyEvent(disagreementId));
    });

    await waitFor(() =>
      expect(recoveryApiMock.getSnapshot).toHaveBeenCalledWith(
        activeGameId,
        'private-token',
      ),
    );
    expect(screen.getByTestId('active-game')).toHaveTextContent(activeGameId);
  });

  it('drops the connection when the socket identity differs from REST', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    renderRealtime();
    await waitFor(() => expect(realtimeMock.listener).toBeTypeOf('function'));
    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('ready'),
    );

    act(() => {
      realtimeMock.listener?.({
        ...sessionReadyEvent(activeGameId),
        payload: {
          ...sessionReadyEvent(activeGameId).payload,
          guest: {
            ...sessionReadyEvent(activeGameId).payload.guest,
            id: '55555555-5555-4555-8555-555555555555',
          },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent(
        'identity-lost',
      ),
    );
    expect(realtimeMock.disconnect).toHaveBeenCalled();
  });

  it('publishes a sync acknowledgement and clears a terminal active game', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    const terminal = snapshot({
      clocks: {
        blackMs: 0,
        running: null,
        serverTime: 1_785_000_000_000,
        whiteMs: 12_000,
      },
      result: 'white_win',
      status: 'COMPLETED',
      termination: 'timeout',
    });
    realtimeMock.emitCommand.mockResolvedValue(snapshotAck(terminal));
    const queryClient = createQueryClient();
    renderRealtime(queryClient);
    await waitFor(() => expect(realtimeMock.connect).toHaveBeenCalledOnce());

    act(() => transportStore.connected());

    await waitFor(() =>
      expect(
        queryClient.getQueryData(queryKeys.games.snapshot(activeGameId)),
      ).toMatchObject({
        gameVersion: 7,
        result: 'white_win',
        status: 'COMPLETED',
      }),
    );
    expect(screen.getByTestId('active-game')).toHaveTextContent('none');
  });

  it('reconciles a session-ready sync acknowledgement with HTTP truth', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    realtimeMock.emitCommand.mockResolvedValue(sessionReadyAck(disagreementId));
    sessionApiMock.getActive.mockResolvedValue({
      correlationId: '44444444-4444-4444-8444-444444444444',
      gameId: null,
    });
    renderRealtime();
    await waitFor(() => expect(realtimeMock.connect).toHaveBeenCalledOnce());

    act(() => transportStore.connected());

    await waitFor(() =>
      expect(screen.getByTestId('active-game')).toHaveTextContent('none'),
    );
    expect(recoveryApiMock.getSnapshot).not.toHaveBeenCalled();
  });

  it('accepts a complete snapshot event and recovers after an incremental event', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    const queryClient = createQueryClient();
    renderRealtime(queryClient);
    await waitFor(() => expect(realtimeMock.listener).toBeTypeOf('function'));
    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('ready'),
    );

    act(() => {
      realtimeMock.listener?.(snapshotEvent(snapshot()));
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(queryKeys.games.snapshot(activeGameId)),
      ).toMatchObject({ gameVersion: 7 }),
    );

    recoveryApiMock.getSnapshot.mockClear();
    act(() => {
      realtimeMock.listener?.({
        eventId: '77777777-7777-4777-8777-777777777777',
        gameId: activeGameId,
        gameVersion: 8,
        payload: {
          clocks: snapshot().clocks,
          initialFen: snapshot().initialFen,
          turn: 'white',
        },
        protocolVersion: 1,
        timestamp: 1_785_000_000_000,
        type: 'game.started',
      });
    });
    await waitFor(() =>
      expect(recoveryApiMock.getSnapshot).toHaveBeenCalledWith(
        activeGameId,
        'private-token',
      ),
    );
  });

  it('uses the socket active game when the independent lookup is unavailable', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    sessionApiMock.getActive.mockRejectedValue(new Error('offline'));
    renderRealtime();
    await waitFor(() => expect(realtimeMock.listener).toBeTypeOf('function'));
    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('ready'),
    );

    act(() => {
      realtimeMock.listener?.(sessionReadyEvent(disagreementId));
    });

    await waitFor(() =>
      expect(screen.getByTestId('active-game')).toHaveTextContent(
        disagreementId,
      ),
    );
  });

  it('runs authoritative recovery for a stale rejected move', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    renderRealtime();
    await waitFor(() => expect(realtimeMock.listener).toBeTypeOf('function'));
    await waitFor(() =>
      expect(screen.getByTestId('session-status')).toHaveTextContent('ready'),
    );

    act(() => {
      realtimeMock.listener?.({
        clientMoveId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        gameId: activeGameId,
        gameVersion: 8,
        payload: {
          authoritativeVersion: 8,
          code: 'STALE_GAME_VERSION',
          message: 'Refresh the board.',
          retryable: true,
        },
        protocolVersion: 1,
        timestamp: 1_785_000_000_000,
        type: 'move.rejected',
      });
    });

    await waitFor(() =>
      expect(recoveryApiMock.getSnapshot).toHaveBeenCalledWith(
        activeGameId,
        'private-token',
      ),
    );
  });

  it('renews a rejected socket identity and exposes renewal failure safely', async () => {
    navigation.pathname = `/game/${activeGameId}`;
    coordinatorMock.renewReadySession.mockResolvedValue({
      ...ready(),
      activeGameId: null,
    });
    renderRealtime();
    await waitFor(() => expect(realtimeMock.connect).toHaveBeenCalledOnce());

    act(() => {
      transportStore.issue({
        code: 'UNAUTHORIZED',
        message: 'private transport detail',
        retryable: false,
      });
    });
    await waitFor(() =>
      expect(coordinatorMock.renewReadySession).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('active-game')).toHaveTextContent('none'),
    );
    expect(screen.getByTestId('transport-issue')).toHaveTextContent('none');

    coordinatorMock.renewReadySession.mockRejectedValue(
      new Error('renew unavailable'),
    );
    act(() => {
      transportStore.clearIssue();
    });
    await waitFor(() =>
      expect(screen.getByTestId('transport-issue')).toHaveTextContent('none'),
    );
    act(() => {
      transportStore.issue({
        code: 'UNAUTHORIZED',
        message: 'private transport detail',
        retryable: false,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('transport-status')).toHaveTextContent(
        'unavailable',
      ),
    );
    expect(screen.getByTestId('transport-issue')).toHaveTextContent(
      'SESSION_RENEWAL_FAILED',
    );
  });

  it('surfaces bounded connection and recovery failures while retry remains available', async () => {
    const user = userEvent.setup();
    navigation.pathname = `/game/${activeGameId}`;
    realtimeMock.connect.mockRejectedValueOnce(new Error('socket offline'));
    sessionApiMock.getActive.mockRejectedValue(new Error('http offline'));
    renderRealtime();

    await waitFor(() =>
      expect(screen.getByTestId('transport-status')).toHaveTextContent(
        'unavailable',
      ),
    );
    expect(screen.getByTestId('transport-issue')).toHaveTextContent(
      'CONNECTION_FAILED',
    );

    realtimeMock.connect.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Retry connection' }));
    await waitFor(() => expect(realtimeMock.connect).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'Recover state' }));
    await waitFor(() =>
      expect(screen.getByTestId('transport-issue')).toHaveTextContent(
        'RECOVERY_FAILED',
      ),
    );
  });
});

function renderRealtime(queryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GuestSessionProvider>
        <RealtimeProvider>
          <Probe />
        </RealtimeProvider>
      </GuestSessionProvider>
    </QueryClientProvider>,
  );
}

function Probe() {
  const session = useGuestSession();
  const realtime = useRealtime();
  const transport = useTransportStore((state) => state.status);
  const issue = useTransportStore((state) => state.issue);
  return (
    <>
      <output data-testid="session-status">{session.view.status}</output>
      <output data-testid="active-game">
        {session.view.status === 'ready'
          ? (session.view.activeGameId ?? 'none')
          : 'unavailable'}
      </output>
      <output data-testid="transport-status">{transport}</output>
      <output data-testid="transport-issue">{issue?.code ?? 'none'}</output>
      <button onClick={() => void realtime.recover()} type="button">
        Recover state
      </button>
      <button onClick={() => void realtime.retryConnection()} type="button">
        Retry connection
      </button>
    </>
  );
}

function ready() {
  return {
    activeGameId,
    activeGameStatus: 'available',
    guest: {
      avatar: 'knight_amber_01',
      expiresAt: '2099-07-28T20:00:00.000Z',
      id: guestId,
      issuedAt: '2026-07-28T08:00:00.000Z',
      name: 'SilentKnight482',
    },
    status: 'ready',
  } as const;
}

function sessionReadyEvent(socketActiveGameId: string) {
  return {
    eventId: '66666666-6666-4666-8666-666666666666',
    payload: {
      activeGameId: socketActiveGameId,
      guest: {
        avatar: 'knight_amber_01',
        expiresAt: '2099-07-28T20:00:00.000Z',
        id: guestId,
        name: 'SilentKnight482',
      },
    },
    protocolVersion: 1,
    timestamp: 1_785_000_000_000,
    type: 'session.ready',
  } as const;
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    clocks: {
      blackMs: 298_000,
      running: 'white',
      serverTime: 1_785_000_000_000,
      whiteMs: 300_000,
    },
    currentFen: '8/8/8/8/8/8/8/8 w - - 0 1',
    gameId: activeGameId,
    gameVersion: 7,
    initialFen: '8/8/8/8/8/8/8/8 w - - 0 1',
    moves: [],
    opponent: {
      avatar: 'knight_black_01',
      color: 'black',
      connected: true,
      name: 'NobleRook91',
    },
    result: null,
    status: 'IN_PROGRESS',
    termination: null,
    turn: 'white',
    you: {
      avatar: 'knight_amber_01',
      color: 'white',
      connected: true,
      name: 'SilentKnight482',
    },
    ...overrides,
  };
}

function sessionReadyAck(socketActiveGameId: string) {
  return {
    correlationId: '88888888-8888-4888-8888-888888888888',
    ok: true,
    payload: sessionReadyEvent(socketActiveGameId).payload,
    protocolVersion: 1,
    requestEventId: '99999999-9999-4999-8999-999999999999',
    type: 'session.ready',
  } as const;
}

function snapshotAck(value: GameSnapshot) {
  return {
    correlationId: '88888888-8888-4888-8888-888888888888',
    gameVersion: value.gameVersion,
    ok: true,
    payload: snapshotPayload(value),
    protocolVersion: 1,
    requestEventId: '99999999-9999-4999-8999-999999999999',
    type: 'game.snapshot',
  } as const;
}

function snapshotEvent(value: GameSnapshot) {
  return {
    eventId: '77777777-7777-4777-8777-777777777777',
    gameId: value.gameId,
    gameVersion: value.gameVersion,
    payload: snapshotPayload(value),
    protocolVersion: 1,
    timestamp: 1_785_000_000_000,
    type: 'game.snapshot',
  } as const;
}

function snapshotPayload(value: GameSnapshot) {
  return {
    clocks: value.clocks,
    currentFen: value.currentFen,
    initialFen: value.initialFen,
    moves: value.moves,
    opponent: value.opponent,
    result: value.result,
    status: value.status,
    termination: value.termination,
    turn: value.turn,
    you: value.you,
  };
}
