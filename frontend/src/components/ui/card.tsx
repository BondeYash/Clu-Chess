import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from '@/lib/class-names';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'article' | 'div' | 'section';
  children: ReactNode;
  selected?: boolean;
  variant?: 'default' | 'interactive' | 'inverse';
}

export function Card({
  as: Component = 'div',
  children,
  className,
  selected = false,
  variant = 'default',
  ...props
}: CardProps) {
  return (
    <Component
      className={classNames(
        'card',
        `card--${variant}`,
        selected && 'card--selected',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
