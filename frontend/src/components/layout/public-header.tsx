import Link from 'next/link';

import { Wordmark } from '@/components/brand/wordmark';

export function PublicHeader() {
  return (
    <header className="public-header">
      <Wordmark />
      <nav aria-label="Primary">
        <Link className="text-link" href="/play">
          Open app
        </Link>
      </nav>
    </header>
  );
}
