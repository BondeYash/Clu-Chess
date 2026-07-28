import type { ButtonHTMLAttributes } from 'react';

import { classNames } from '@/lib/class-names';

export type ButtonVariant = 'destructive' | 'primary' | 'quiet' | 'secondary';

export function buttonClassName({
  className,
  size = 'default',
  variant = 'primary',
}: {
  className?: string | undefined;
  size?: 'compact' | 'default' | undefined;
  variant?: ButtonVariant | undefined;
} = {}) {
  return classNames(
    'button',
    `button--${variant}`,
    size === 'compact' && 'button--compact',
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean;
  pendingLabel?: string;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  disabled,
  pending = false,
  pendingLabel = 'Working…',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      aria-busy={pending || undefined}
      className={buttonClassName({ className, variant })}
      disabled={disabled || pending}
      type={type}
      {...props}
    >
      {pending ? <span aria-hidden="true" className="spinner" /> : null}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}
