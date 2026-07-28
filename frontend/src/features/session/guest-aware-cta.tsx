'use client';

import { ArrowRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { buttonClassName } from '@/components/ui/button';

import { useGuestSession } from './session-provider';

export function GuestAwareCta() {
  const { view } = useGuestSession();
  const activeGameId = view.status === 'ready' ? view.activeGameId : null;
  const href = (activeGameId ? `/game/${activeGameId}` : '/play') as Route;
  const label =
    view.status === 'ready'
      ? activeGameId
        ? 'Resume your game'
        : `Continue as ${view.guest.name}`
      : view.status === 'loading'
        ? 'Checking your board…'
        : 'Find a match';

  return (
    <Link className={buttonClassName()} href={href}>
      {label}
      <ArrowRight aria-hidden="true" size={18} />
    </Link>
  );
}
