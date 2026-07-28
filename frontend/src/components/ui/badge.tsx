import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  TriangleAlert,
} from 'lucide-react';
import type { HTMLAttributes } from 'react';

import { classNames } from '@/lib/class-names';

export type BadgeTone = 'danger' | 'neutral' | 'success' | 'warning';

const ICONS = {
  danger: CircleAlert,
  neutral: CircleMinus,
  success: CircleCheck,
  warning: TriangleAlert,
} satisfies Record<BadgeTone, typeof CircleCheck>;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({
  children,
  className,
  tone = 'neutral',
  ...props
}: BadgeProps) {
  const Icon = ICONS[tone];

  return (
    <span
      className={classNames('badge', `badge--${tone}`, className)}
      {...props}
    >
      <Icon aria-hidden="true" size={14} strokeWidth={2.25} />
      <span>{children}</span>
    </span>
  );
}
