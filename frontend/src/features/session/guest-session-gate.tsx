'use client';

import type { ReactNode } from 'react';

import { FeedbackState, Skeleton } from '@/components/ui';
import { presentApiError } from '@/lib/api/error-copy';

import { useGuestSession } from './session-provider';

export function GuestSessionGate({ children }: { children: ReactNode }) {
  const { retry, view } = useGuestSession();

  if (view.status === 'ready') return children;
  if (view.status === 'loading' || view.status === 'idle') {
    return (
      <div aria-label="Preparing your guest session" className="session-gate">
        <Skeleton variant="player" />
        <Skeleton variant="card" />
      </div>
    );
  }
  if (view.status === 'identity-lost') {
    return (
      <FeedbackState
        actionLabel="Try cookie recovery again"
        kind="error"
        onAction={() => void retry()}
        size="route"
        title="Your active identity could not be recovered"
      >
        <p>
          CluChess will not create a different guest while an active game may
          belong to this tab. Retry recovery before continuing.
        </p>
      </FeedbackState>
    );
  }
  if (view.status === 'error') {
    const copy = presentApiError(view.error);
    return (
      <FeedbackState
        actionLabel={copy.actionLabel}
        {...(copy.correlationId ? { correlationId: copy.correlationId } : {})}
        kind="error"
        onAction={() => void retry()}
        size="route"
        title={copy.title}
      >
        <p>{copy.message}</p>
      </FeedbackState>
    );
  }
  return (
    <FeedbackState kind="empty" size="route" title="No guest identity yet">
      <p>Open Play to create a temporary guest identity.</p>
    </FeedbackState>
  );
}
