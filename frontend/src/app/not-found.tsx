import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="centered-state">
      <p className="eyebrow">404 · Off the board</p>
      <h1>That square does not exist.</h1>
      <p>The address may be incomplete or the view may have moved.</p>
      <Link className="primary-action" href="/">
        Return home
      </Link>
    </main>
  );
}
