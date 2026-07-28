import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transportStore } from '@/stores/transport-store';

import { RealtimeContext } from './realtime-context';
import { TransportBanner } from './transport-banner';

const recover = vi.fn().mockResolvedValue(undefined);
const retryConnection = vi.fn().mockResolvedValue(undefined);

describe('TransportBanner', () => {
  beforeEach(() => {
    transportStore.reset();
    recover.mockClear();
    retryConnection.mockClear();
  });

  it('stays out of the document while transport is healthy', () => {
    transportStore.connected();
    renderBanner();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('announces reconnecting without hiding the last safe content', async () => {
    const user = userEvent.setup();
    transportStore.reconnecting(2);
    renderBanner();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Reconnecting · attempt 2',
    );
    await user.click(screen.getByRole('button', { name: 'Recover now' }));
    expect(recover).toHaveBeenCalledOnce();
  });

  it('shows a correlated retry action for a terminal handshake failure', async () => {
    const user = userEvent.setup();
    transportStore.issue({
      code: 'SERVICE_UNAVAILABLE',
      correlationId: '11111111-1111-4111-8111-111111111111',
      message: 'The server is restarting.',
      retryable: true,
    });
    transportStore.status('unavailable');
    renderBanner();

    expect(screen.getByRole('alert')).toHaveTextContent(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The live service is restarting.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'The server is restarting.',
    );
    await user.click(screen.getByRole('button', { name: 'Try connection' }));
    expect(retryConnection).toHaveBeenCalledOnce();
  });

  it('turns a failed manual retry into a safe unavailable state', async () => {
    const user = userEvent.setup();
    retryConnection.mockRejectedValueOnce(new Error('private socket detail'));
    transportStore.status('unavailable');
    renderBanner();

    await user.click(screen.getByRole('button', { name: 'Try connection' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Live state could not be confirmed.',
      ),
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'private socket detail',
    );
  });
});

function renderBanner() {
  return render(
    <RealtimeContext.Provider value={{ recover, retryConnection }}>
      <TransportBanner />
    </RealtimeContext.Provider>,
  );
}
