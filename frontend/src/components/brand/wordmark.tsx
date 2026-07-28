import Image from 'next/image';
import Link from 'next/link';

import { classNames } from '@/lib/class-names';

export function Wordmark({
  compact = false,
  inverse = false,
}: {
  compact?: boolean;
  inverse?: boolean;
}) {
  return (
    <Link
      aria-label="CluChess home"
      className={classNames(
        'wordmark',
        compact && 'wordmark--compact',
        inverse && 'wordmark--inverse',
      )}
      href="/"
    >
      <Image
        alt=""
        aria-hidden="true"
        className="wordmark__mark"
        height={36}
        priority
        src="/brand/cluchess-mark.svg"
        width={36}
      />
      {compact ? null : <span>CluChess</span>}
    </Link>
  );
}
