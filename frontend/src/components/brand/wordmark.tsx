import Link from 'next/link';

export function Wordmark() {
  return (
    <Link aria-label="Cluchess home" className="wordmark" href="/">
      <span aria-hidden="true" className="wordmark__mark">
        C
      </span>
      <span>Cluchess</span>
    </Link>
  );
}
