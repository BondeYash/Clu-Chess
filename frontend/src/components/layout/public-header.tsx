import Link from 'next/link';

import { Wordmark } from '@/components/brand/wordmark';
import { buttonClassName } from '@/components/ui/button';

export function PublicHeader() {
  return (
    <header className="public-header">
      <Wordmark />
      <nav aria-label="Primary" className="public-header__nav">
        <Link
          className="public-header__link public-header__link--secondary"
          href="/play"
        >
          Play
        </Link>
        <Link
          className="public-header__link public-header__link--secondary"
          href="/learn"
        >
          Learn
        </Link>
        <Link
          className={buttonClassName({
            className: 'button--compact',
            variant: 'primary',
          })}
          href="/play"
        >
          Play now
        </Link>
      </nav>
    </header>
  );
}
