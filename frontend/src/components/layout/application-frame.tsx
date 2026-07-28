import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';

export function ApplicationFrame({ children }: { children: ReactNode }) {
  return (
    <div className="application-frame">
      <header className="application-header">
        <Wordmark />
        <span className="foundation-badge">Foundation preview</span>
      </header>
      <main className="application-main">{children}</main>
    </div>
  );
}
