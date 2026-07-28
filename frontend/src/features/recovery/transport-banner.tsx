'use client';

import { CloudOff, RefreshCw, Radio, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { transportStore, useTransportStore } from '@/stores/transport-store';

import { useOptionalRealtime } from './realtime-context';

export function TransportBanner() {
  const realtime = useOptionalRealtime();
  const [pending, setPending] = useState(false);
  const issue = useTransportStore((state) => state.issue);
  const reconnectAttempt = useTransportStore((state) => state.reconnectAttempt);
  const status = useTransportStore((state) => state.status);

  if (!realtime || status === 'idle' || (status === 'connected' && !issue)) {
    return null;
  }
  const { recover, retryConnection } = realtime;

  const unavailable = status === 'unavailable';
  const Icon = unavailable
    ? CloudOff
    : issue
      ? TriangleAlert
      : status === 'connecting'
        ? Radio
        : RefreshCw;
  const title =
    status === 'connecting'
      ? 'Connecting the live board'
      : status === 'reconnecting'
        ? `Reconnecting${
            reconnectAttempt > 0 ? ` · attempt ${reconnectAttempt}` : ''
          }`
        : unavailable
          ? 'Live updates are unavailable'
          : 'A live update needs recovery';
  const message =
    (issue ? issueMessage(issue.code) : undefined) ??
    (status === 'reconnecting'
      ? 'Your last confirmed board remains visible while the connection returns.'
      : 'CluChess is opening one secure realtime connection for this tab.');

  async function act() {
    setPending(true);
    try {
      if (unavailable) await retryConnection();
      else await recover();
    } catch {
      transportStore.issue({
        code: 'CONNECTION_FAILED',
        message: 'The realtime connection could not be restarted.',
        retryable: true,
      });
      transportStore.status('unavailable');
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={`transport-banner transport-banner--${status}`}
      role={unavailable || issue ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" size={20} />
      <div className="transport-banner__copy">
        <strong>{title}</strong>
        <span>{message}</span>
        {issue?.correlationId ? (
          <span>
            Reference: <code>{issue.correlationId}</code>
          </span>
        ) : null}
      </div>
      {status !== 'connecting' ? (
        <Button
          className="button--compact"
          onClick={() => void act()}
          pending={pending}
          pendingLabel="Recovering…"
          variant="secondary"
        >
          {unavailable ? 'Try connection' : 'Recover now'}
        </Button>
      ) : null}
    </section>
  );
}

function issueMessage(code: string): string {
  switch (code) {
    case 'ACK_TIMEOUT':
      return 'The server did not confirm the last request in time. The last confirmed board remains visible.';
    case 'INVALID_ACK':
    case 'INVALID_SERVER_EVENT':
      return 'A live update could not be verified, so it was not applied to the board.';
    case 'RATE_LIMITED':
      return 'Live requests are arriving too quickly. Wait a moment, then recover the board.';
    case 'SERVICE_UNAVAILABLE':
      return 'The live service is restarting. The last confirmed board remains visible.';
    case 'SESSION_RENEWAL_FAILED':
    case 'UNAUTHORIZED':
      return 'This guest identity needs to be re-established before live play can continue.';
    default:
      return 'Live state could not be confirmed. Recover the board from the authoritative service.';
  }
}
