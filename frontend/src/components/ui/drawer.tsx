'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { classNames } from '@/lib/class-names';

import { IconButton } from './icon-button';

export function Drawer({
  children,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <aside
      aria-hidden={!open}
      aria-label={title}
      className={classNames('drawer', open && 'drawer--open')}
      inert={!open}
    >
      <div className="drawer__header">
        <h2>{title}</h2>
        <IconButton aria-label="Close panel" onClick={onClose}>
          <X aria-hidden="true" size={20} />
        </IconButton>
      </div>
      <div className="drawer__body">{children}</div>
    </aside>
  );
}
