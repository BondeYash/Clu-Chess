'use client';

import type { ButtonHTMLAttributes } from 'react';

import { classNames } from '@/lib/class-names';

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role'
> {
  checked: boolean;
  label: string;
  onCheckedChange?: (checked: boolean) => void;
}

export function Switch({
  checked,
  className,
  disabled,
  label,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={classNames('switch', checked && 'switch--checked', className)}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      role="switch"
      type="button"
      {...props}
    >
      <span aria-hidden="true" className="switch__thumb" />
      <span className="sr-only">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}
