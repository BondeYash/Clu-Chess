import type { ReactNode } from 'react';

import { PublicFooter } from '@/components/layout/public-footer';
import { PublicHeader } from '@/components/layout/public-header';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <PublicHeader />
      <main className="public-main" id="main-content">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
