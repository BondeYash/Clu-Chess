'use client';

import { useEffect } from 'react';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="centered-state">
      <p className="eyebrow">Something shifted</p>
      <h1>We could not prepare this view.</h1>
      <p>Your session has not been changed. Try rendering the view again.</p>
      <button className="primary-action" onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
