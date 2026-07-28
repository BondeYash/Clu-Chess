'use client';

import { BookOpen, Settings, Swords } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { Avatar } from '@/components/ui/avatar';
import { classNames } from '@/lib/class-names';

import { ConnectionBadge } from './connection-badge';

const NAVIGATION = [
  { href: '/play', icon: Swords, label: 'Play' },
  { href: '/learn/king', icon: BookOpen, label: 'Learn' },
  { href: '/settings', icon: Settings, label: 'Settings' },
] as const;

export function ApplicationFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/play';
  const focusMode = pathname.startsWith('/game/');
  const title = pathname.startsWith('/game/')
    ? 'Game'
    : pathname.startsWith('/settings')
      ? 'Settings'
      : 'Play';

  return (
    <div
      className={classNames(
        'application-frame',
        focusMode && 'application-frame--focus',
      )}
    >
      <a className="skip-link" href="#application-content">
        Skip to main content
      </a>
      <aside className="desktop-rail">
        <div className="desktop-rail__mark">
          <Wordmark compact inverse />
        </div>
        <nav aria-label="Application" className="desktop-rail__nav">
          {NAVIGATION.map((item) => {
            const current =
              item.href === '/play'
                ? pathname === '/play'
                : pathname.startsWith(item.href.replace('/king', ''));
            const Icon = item.icon;
            return (
              <Link
                aria-current={current ? 'page' : undefined}
                className="nav-item"
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" size={21} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <header className="application-header">
        <h1 className="application-header__title">{title}</h1>
        <div className="application-header__tools">
          <ConnectionBadge />
          <div className="application-header__identity">
            <Avatar size="sm" value="knight_amber_01" />
            <span title="SilentKnight482">SilentKnight482</span>
          </div>
        </div>
      </header>
      <main className="application-main" id="application-content">
        <div className="application-main__inner">{children}</div>
      </main>
      <nav aria-label="Application" className="mobile-nav">
        {NAVIGATION.map((item) => {
          const current =
            item.href === '/play'
              ? pathname === '/play'
              : pathname.startsWith(item.href.replace('/king', ''));
          const Icon = item.icon;
          return (
            <Link
              aria-current={current ? 'page' : undefined}
              className="nav-item"
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden="true" size={21} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
