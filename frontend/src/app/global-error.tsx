'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="centered-state">
          <h1>Cluchess needs a fresh start.</h1>
          <p>The application shell could not be loaded.</p>
          <button className="primary-action" onClick={reset} type="button">
            Reload the shell
          </button>
        </main>
      </body>
    </html>
  );
}
