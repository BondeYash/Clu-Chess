import {
  CircleCheck,
  CloudOff,
  Inbox,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';

type FeedbackKind = 'empty' | 'error' | 'offline' | 'success';
type FeedbackSize = 'compact' | 'route';

const ICONS = {
  empty: Inbox,
  error: TriangleAlert,
  offline: CloudOff,
  success: CircleCheck,
} satisfies Record<FeedbackKind, typeof CircleCheck>;

export interface FeedbackStateProps {
  actionLabel?: string;
  children?: ReactNode;
  correlationId?: string;
  kind: FeedbackKind;
  onAction?: () => void;
  size?: FeedbackSize;
  title: string;
}

export function FeedbackState({
  actionLabel,
  children,
  correlationId,
  kind,
  onAction,
  size = 'compact',
  title,
}: FeedbackStateProps) {
  const Icon = ICONS[kind];

  return (
    <section
      className={`feedback-state feedback-state--${size}`}
      role={kind === 'error' || kind === 'offline' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" className="feedback-state__icon" size={28} />
      <div>
        <h2>{title}</h2>
        {children ? (
          <div className="feedback-state__copy">{children}</div>
        ) : null}
        {correlationId ? (
          <p className="feedback-state__reference">
            Reference: <code>{correlationId}</code>
          </p>
        ) : null}
        {actionLabel && onAction ? (
          <Button
            onClick={onAction}
            variant={kind === 'error' ? 'primary' : 'secondary'}
          >
            {kind === 'offline' ? (
              <RefreshCw aria-hidden="true" size={17} />
            ) : null}
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
