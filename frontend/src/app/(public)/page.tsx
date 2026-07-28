import { PROTOCOL_VERSION } from '@cluchess/protocol-v1/constants';
import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__copy">
        <p className="eyebrow">One board. One honest contest.</p>
        <h1 id="hero-title">Chess with the noise turned down.</h1>
        <p className="hero__summary">
          Cluchess is being built for quick, focused games with no account
          ceremony and a server-authoritative rules engine.
        </p>
        <div className="hero__actions">
          <Link className="primary-action" href="/play">
            Enter the board
          </Link>
          <span className="protocol-note">Protocol v{PROTOCOL_VERSION}</span>
        </div>
      </div>
      <div className="board-study" aria-label="Abstract chessboard preview">
        <div className="board-study__label">
          <span>Position study</span>
          <span>Foundation build</span>
        </div>
        <div aria-hidden="true" className="board-study__grid">
          {Array.from({ length: 16 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <p>
          Gameplay arrives in a later phase. This route deliberately makes no
          health request and remains useful while backend services start.
        </p>
      </div>
    </section>
  );
}
