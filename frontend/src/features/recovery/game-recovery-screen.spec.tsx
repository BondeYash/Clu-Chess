import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { createQueryClient } from '@/lib/query-client';
import { transportStore } from '@/stores/transport-store';

import type { GameSnapshot } from './game-recovery-types';

const sessionMock = vi.hoisted(() => ({
  view: {
    activeGameId: null as string | null,
    activeGameStatus: 'available',
    guest: {
      avatar: 'knight_amber_01',
      expiresAt: '2099-07-28T20:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
      issuedAt: '2026-07-28T08:00:00.000Z',
      name: 'SilentKnight482',
    },
    status: 'ready',
  },
}));
const recoveryApiMock = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
}));
const realtimeMock = vi.hoisted(() => ({
  recover: vi.fn().mockResolvedValue(undefined),
  retryConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/session/session-provider', () => ({
  useGuestSession: () => sessionMock,
}));
vi.mock('./game-recovery-api', () => ({
  gameRecoveryApi: recoveryApiMock,
}));
vi.mock('./realtime-context', () => ({
  useRealtime: () => realtimeMock,
}));

import { sessionStorageAdapter } from '@/features/session/session-storage';

import { GameRecoveryScreen } from './game-recovery-screen';

const gameId = '22222222-2222-4222-8222-222222222222';

describe('GameRecoveryScreen', () => {
  beforeEach(() => {
    sessionMock.view.activeGameId = null;
    sessionStorageAdapter.clearAll();
    sessionStorageAdapter.setToken('private-token');
    transportStore.reset();
    transportStore.status('connected');
    recoveryApiMock.getSnapshot.mockReset().mockResolvedValue(snapshot());
    realtimeMock.recover.mockClear();
    realtimeMock.retryConnection.mockClear();
  });

  it('renders an authoritative, read-only board with keyboard-scrollable moves', async () => {
    const { container } = renderScreen();

    const board = await screen.findByRole('grid', {
      name: 'Recovered game board, white orientation',
    });
    expect(board).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Move history' }),
    ).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('NobleRook91')).toBeVisible();
    expect(screen.getByText('Version 7')).toBeVisible();
    expect(
      screen.getByRole('gridcell', { name: /e4, white pawn/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });

  it('keeps non-member and missing-game responses privacy safe', async () => {
    recoveryApiMock.getSnapshot.mockRejectedValue(
      new ApiError({
        code: 'NOT_A_PLAYER',
        correlationId: '33333333-3333-4333-8333-333333333333',
        message: 'Private server detail',
        retryable: false,
        status: 403,
      }),
    );
    renderScreen();

    await waitFor(() =>
      expect(
        screen.getByRole('heading', {
          name: 'This game is not available to this guest',
        }),
      ).toBeVisible(),
    );
    expect(screen.queryByText('NobleRook91')).not.toBeInTheDocument();
    expect(screen.queryByText('Private server detail')).not.toBeInTheDocument();
  });

  it('refuses to draw an invalid server position', async () => {
    const user = userEvent.setup();
    recoveryApiMock.getSnapshot.mockResolvedValue({
      ...snapshot(),
      currentFen: 'uncertain',
    });
    renderScreen();

    expect(
      await screen.findByRole('heading', {
        name: 'The recovered board could not be verified',
      }),
    ).toBeVisible();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Request a fresh snapshot' }),
    );
    expect(realtimeMock.recover).toHaveBeenCalled();
  });

  it('renders a correlated offline recovery action for service failures', async () => {
    const user = userEvent.setup();
    recoveryApiMock.getSnapshot.mockRejectedValue(
      new ApiError({
        code: 'SERVICE_UNAVAILABLE',
        correlationId: '33333333-3333-4333-8333-333333333333',
        message: 'private server detail',
        retryable: false,
        status: 503,
      }),
    );
    renderScreen();

    await expectHeading('The board could not be recovered');
    expect(screen.getByText(/33333333-3333-4333/)).toBeVisible();
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Try recovery again' }),
    );
    await waitFor(() =>
      expect(recoveryApiMock.getSnapshot).toHaveBeenCalledTimes(2),
    );
  });

  it('offers the guest-owned active game without disclosing the private link', async () => {
    const ownedGameId = '44444444-4444-4444-8444-444444444444';
    sessionMock.view.activeGameId = ownedGameId;
    recoveryApiMock.getSnapshot.mockRejectedValue(
      new ApiError({
        code: 'GAME_NOT_FOUND',
        message: 'private server detail',
        retryable: false,
        status: 404,
      }),
    );
    renderScreen();

    await expectHeading('This game is not available to this guest');
    expect(
      screen.getByRole('link', { name: 'Open your active game' }),
    ).toHaveAttribute('href', `/game/${ownedGameId}`);
  });

  it('renders a terminal black orientation and an empty move record', async () => {
    const user = userEvent.setup();
    transportStore.status('unavailable');
    recoveryApiMock.getSnapshot.mockResolvedValue(
      snapshot({
        clocks: {
          blackMs: 12_000,
          running: null,
          serverTime: 1_785_000_000_000,
          whiteMs: 0,
        },
        moves: [],
        opponent: {
          avatar: 'knight_amber_01',
          color: 'white',
          connected: false,
          name: 'SilentKnight482',
        },
        result: 'black_win',
        status: 'COMPLETED',
        termination: 'timeout',
        you: {
          avatar: 'knight_black_01',
          color: 'black',
          connected: true,
          name: 'NobleRook91',
        },
      }),
    );
    renderScreen();

    expect(
      await screen.findByRole('grid', {
        name: 'Recovered game board, black orientation',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'The record is complete.' }),
    ).toBeVisible();
    expect(screen.getByText('No moves have been confirmed yet.')).toBeVisible();
    expect(screen.getByText(/last confirmed server snapshot/i)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Refresh safe position' }),
    );
    expect(realtimeMock.recover).toHaveBeenCalled();
  });
});

function renderScreen() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <GameRecoveryScreen gameId={gameId} />
    </QueryClientProvider>,
  );
}

async function expectHeading(name: string) {
  await waitFor(() =>
    expect(screen.getByRole('heading', { name })).toBeVisible(),
  );
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    clocks: {
      blackMs: 298_000,
      running: 'white',
      serverTime: 1_785_000_000_000,
      whiteMs: 300_000,
    },
    correlationId: '33333333-3333-4333-8333-333333333333',
    currentFen:
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    gameId,
    gameVersion: 7,
    initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [
      { color: 'white', ply: 1, san: 'e4', uci: 'e2e4' },
      { color: 'black', ply: 2, san: 'e5', uci: 'e7e5' },
      { color: 'white', ply: 3, san: 'Nf3', uci: 'g1f3' },
      { color: 'black', ply: 4, san: 'Nc6', uci: 'b8c6' },
    ],
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
