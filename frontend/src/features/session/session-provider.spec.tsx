import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '@/lib/query-client';

const navigation = vi.hoisted(() => ({
  pathname: '/' as string | null,
}));
const coordinatorMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  renewalDelay: vi.fn(),
  renewReadySession: vi.fn(),
  resetAndCreate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock('./session-coordinator', () => {
  return {
    sessionCoordinator: coordinatorMock,
  };
});

import type { SessionBootstrapResult } from './session-coordinator';
import {
  GuestSessionProvider,
  useGuestSession,
  useOptionalGuestSession,
} from './session-provider';

const readySession: Extract<SessionBootstrapResult, { status: 'ready' }> = {
  activeGameId: null,
  activeGameStatus: 'available',
  guest: {
    avatar: 'knight_amber_01',
    expiresAt: '2099-07-28T20:00:00.000Z',
    id: '11111111-1111-4111-8111-111111111111',
    issuedAt: '2026-07-28T08:00:00.000Z',
    name: 'SilentKnight482',
  },
  status: 'ready',
};

describe('GuestSessionProvider', () => {
  beforeEach(() => {
    navigation.pathname = '/';
    coordinatorMock.bootstrap.mockReset().mockResolvedValue({
      status: 'anonymous',
    });
    coordinatorMock.renewalDelay.mockReset().mockReturnValue(null);
    coordinatorMock.renewReadySession
      .mockReset()
      .mockResolvedValue(readySession);
    coordinatorMock.resetAndCreate.mockReset().mockResolvedValue(readySession);
  });

  it('exposes idle state away from session routes and supports optional access', () => {
    navigation.pathname = '/learn';
    renderProvider(<Probe />);

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(coordinatorMock.bootstrap).not.toHaveBeenCalled();
    expect(useOptionalGuestSession).toBeTypeOf('function');
  });

  it('recovers without creating on the landing page', async () => {
    navigation.pathname = null;
    renderProvider(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );
    expect(coordinatorMock.bootstrap).toHaveBeenCalledWith({
      allowCreate: false,
    });
  });

  it.each(['/play', '/settings', '/game/demo'])(
    'allows identity creation for %s',
    async (pathname) => {
      navigation.pathname = pathname;
      coordinatorMock.bootstrap.mockResolvedValue(readySession);
      renderProvider(<Probe />);

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('ready'),
      );
      expect(coordinatorMock.bootstrap).toHaveBeenCalledWith({
        allowCreate: true,
      });
    },
  );

  it('surfaces bootstrap errors and lets the user retry', async () => {
    const user = userEvent.setup();
    coordinatorMock.bootstrap
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'anonymous' });
    renderProvider(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('error'),
    );
    await user.click(screen.getByRole('button', { name: 'Retry session' }));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );
    expect(coordinatorMock.bootstrap).toHaveBeenCalledTimes(2);
  });

  it('replaces cached identity only after a successful reset', async () => {
    const user = userEvent.setup();
    navigation.pathname = '/settings';
    coordinatorMock.bootstrap.mockResolvedValue(readySession);
    coordinatorMock.resetAndCreate.mockResolvedValue({
      ...readySession,
      guest: { ...readySession.guest, name: 'CopperBishop731' },
    });
    renderProvider(<Probe />);

    expect(await screen.findByText('SilentKnight482')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset session' }));
    expect(await screen.findByText('CopperBishop731')).toBeVisible();
    expect(coordinatorMock.resetAndCreate).toHaveBeenCalledOnce();
  });

  it('publishes scheduled renewal and invalidates after renewal failure', async () => {
    navigation.pathname = '/play';
    coordinatorMock.bootstrap.mockResolvedValue(readySession);
    coordinatorMock.renewalDelay.mockReturnValueOnce(0).mockReturnValue(null);
    coordinatorMock.renewReadySession
      .mockResolvedValueOnce({
        ...readySession,
        guest: { ...readySession.guest, expiresAt: '2100-01-01T00:00:00.000Z' },
      })
      .mockRejectedValueOnce(new Error('offline'));

    const first = renderProvider(<Probe />);
    await waitFor(() =>
      expect(coordinatorMock.renewReadySession).toHaveBeenCalledOnce(),
    );
    first.unmount();

    coordinatorMock.renewalDelay
      .mockReset()
      .mockReturnValueOnce(0)
      .mockReturnValue(null);
    coordinatorMock.renewReadySession
      .mockClear()
      .mockRejectedValueOnce(new Error('offline'));
    const secondQueryClient = createQueryClient();
    const invalidate = vi.spyOn(secondQueryClient, 'invalidateQueries');
    renderProvider(<Probe />, secondQueryClient);
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it('requires the strict hook to be rendered under its provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<UnsafeProbe />)).toThrow(
      'useGuestSession must be used inside GuestSessionProvider',
    );
  });
});

function Probe() {
  const session = useGuestSession();
  return (
    <>
      <output data-testid="status">{session.view.status}</output>
      {'guest' in session.view ? <span>{session.view.guest.name}</span> : null}
      <button onClick={() => void session.retry()} type="button">
        Retry session
      </button>
      <button onClick={() => void session.resetGuest()} type="button">
        Reset session
      </button>
    </>
  );
}

function UnsafeProbe() {
  useGuestSession();
  return null;
}

function renderProvider(
  children: React.ReactNode,
  queryClient = createQueryClient(),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GuestSessionProvider>{children}</GuestSessionProvider>
    </QueryClientProvider>,
  );
}
