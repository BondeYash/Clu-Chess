import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Play',
};

export default function PlayPage() {
  return (
    <section className="placeholder-panel" aria-labelledby="play-heading">
      <p className="eyebrow">App shell online</p>
      <h1 id="play-heading">Your next game will begin here.</h1>
      <p>
        Session creation and matchmaking are intentionally not connected in
        Phase 1. The shell is ready for those feature modules without treating
        backend availability as a page-level dependency.
      </p>
    </section>
  );
}
