export default function Loading() {
  return (
    <main className="centered-state" aria-busy="true" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <p>Setting the board…</p>
    </main>
  );
}
