import Link from 'next/link';

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>Quiet chess, built around the board.</span>
      <nav aria-label="Legal">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/accessibility">Accessibility</Link>
      </nav>
    </footer>
  );
}
