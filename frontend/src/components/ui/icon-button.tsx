import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { classNames } from '@/lib/class-names';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  'aria-label': string;
  children: ReactNode;
  pending?: boolean;
  tone?: 'danger' | 'default';
  tooltip?: string;
}

export function IconButton({
  'aria-label': accessibleName,
  children,
  className,
  disabled,
  pending = false,
  tone = 'default',
  tooltip,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <span className="icon-button-wrap" data-tooltip={tooltip}>
      <button
        aria-busy={pending || undefined}
        aria-label={accessibleName}
        className={classNames(
          'icon-button',
          tone === 'danger' && 'icon-button--danger',
          className,
        )}
        disabled={disabled || pending}
        type={type}
        {...props}
      >
        {pending ? <span aria-hidden="true" className="spinner" /> : children}
      </button>
    </span>
  );
}
