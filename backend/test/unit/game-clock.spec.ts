import { describe, expect, it } from 'vitest';
import {
  admitMoveOnClock,
  checkFlagFall,
  clockDeadline,
  clockViewAt,
  createGameClock,
  pauseClock,
  resumeClock,
  type GameClock,
} from '../../src/modules/game/domain/game-clock.js';
import { GameDomainError } from '../../src/modules/game/domain/game.errors.js';

class FakeServerTime {
  private value: number;

  constructor(value = Date.UTC(2026, 6, 24, 12)) {
    this.value = value;
  }

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }

  now(): Date {
    return new Date(this.value);
  }
}

describe('durable server-authoritative chess clock', () => {
  it('creates a stopped clock and starts it from an explicit server timestamp', () => {
    const time = new FakeServerTime();
    const created = createGameClock(300_000, 2_000);
    const running = resumeClock(created, 'w', time.now());

    expect(created).toEqual({
      blackMs: 300_000,
      incrementMs: 2_000,
      running: null,
      turnStartedAt: null,
      whiteMs: 300_000,
    });
    expect(running).toMatchObject({
      blackMs: 300_000,
      running: 'w',
      whiteMs: 300_000,
    });
    expect(clockDeadline(running)).toEqual(
      new Date(time.now().getTime() + 300_000),
    );
  });

  it('deducts elapsed time, applies increment, and switches the running side', () => {
    const time = new FakeServerTime();
    const running = resumeClock(
      createGameClock(60_000, 2_000),
      'w',
      time.now(),
    );
    time.advance(1_250);

    const admitted = admitMoveOnClock(running, 'w', time.now());

    expect(admitted).toMatchObject({ elapsedMs: 1_250, kind: 'accepted' });
    expect(admitted.clock).toMatchObject({
      blackMs: 60_000,
      running: 'b',
      whiteMs: 60_750,
    });
    expect(admitted.clock.turnStartedAt).toEqual(time.now());
    expect(running.whiteMs).toBe(60_000);
  });

  it('rejects a move at exact zero and does not grant the increment', () => {
    const time = new FakeServerTime();
    const running = resumeClock(
      createGameClock(5_000, 10_000),
      'w',
      time.now(),
    );
    time.advance(5_000);

    const result = admitMoveOnClock(running, 'w', time.now());

    expect(result).toMatchObject({
      clock: {
        blackMs: 5_000,
        running: null,
        turnStartedAt: null,
        whiteMs: 0,
      },
      elapsedMs: 5_000,
      flagged: 'w',
      kind: 'flag_fall',
    });
  });

  it('adjudicates delayed timeout handlers from persisted time alone', () => {
    const time = new FakeServerTime();
    const running = resumeClock(createGameClock(2_000, 0), 'b', time.now());
    time.advance(30_000);

    expect(checkFlagFall(running, time.now())).toMatchObject({
      clock: { blackMs: 0, running: null },
      elapsedMs: 30_000,
      flagged: 'b',
      kind: 'flag_fall',
    });
  });

  it('keeps clocks running through a reconnect grace interval', () => {
    const time = new FakeServerTime();
    const persisted = resumeClock(createGameClock(45_000, 0), 'b', time.now());
    time.advance(30_000);

    expect(clockViewAt(persisted, time.now())).toMatchObject({
      blackMs: 15_000,
      running: 'b',
      whiteMs: 45_000,
    });
    expect(checkFlagFall(persisted, time.now()).kind).toBe('accepted');

    time.advance(15_000);
    expect(checkFlagFall(persisted, time.now())).toMatchObject({
      flagged: 'b',
      kind: 'flag_fall',
    });
  });

  it('supports explicit pause/resume without charging the paused interval', () => {
    const time = new FakeServerTime();
    const running = resumeClock(createGameClock(10_000, 0), 'w', time.now());
    time.advance(1_500);
    const paused = pauseClock(running, time.now());

    expect(paused).toMatchObject({
      clock: { running: null, whiteMs: 8_500 },
      elapsedMs: 1_500,
      kind: 'paused',
    });
    expect(clockDeadline(paused.clock)).toBeNull();

    time.advance(20_000);
    expect(clockViewAt(paused.clock, time.now())).toMatchObject({
      running: null,
      whiteMs: 8_500,
    });

    const resumed = resumeClock(paused.clock, 'w', time.now());
    time.advance(500);
    expect(clockViewAt(resumed, time.now()).whiteMs).toBe(8_000);
  });

  it('clamps display at zero without mutating the persisted clock', () => {
    const time = new FakeServerTime();
    const running = resumeClock(createGameClock(1_000, 0), 'w', time.now());
    time.advance(2_000);

    expect(clockViewAt(running, time.now()).whiteMs).toBe(0);
    expect(running.whiteMs).toBe(1_000);
    expect(running.running).toBe('w');
  });

  it('treats a timestamp earlier than the stored start as zero elapsed', () => {
    const time = new FakeServerTime();
    const startedAt = new Date(time.now().getTime() + 1_000);
    const running = resumeClock(createGameClock(10_000, 500), 'w', startedAt);

    expect(admitMoveOnClock(running, 'w', time.now())).toMatchObject({
      clock: { whiteMs: 10_500 },
      elapsedMs: 0,
      kind: 'accepted',
    });
  });

  it('rejects invalid durations, states, timestamps, movers, and overflow', () => {
    expect(() => createGameClock(0, 0)).toThrow(GameDomainError);
    expect(() => createGameClock(1, -1)).toThrow(GameDomainError);
    expect(() =>
      resumeClock(createGameClock(1, 0), 'w', new Date(Number.NaN)),
    ).toThrow(GameDomainError);

    const time = new FakeServerTime();
    const running = resumeClock(createGameClock(10_000, 0), 'w', time.now());
    expect(() => resumeClock(running, 'b', time.now())).toThrow(
      GameDomainError,
    );
    expect(() => admitMoveOnClock(running, 'b', time.now())).toThrow(
      GameDomainError,
    );

    const inconsistent: GameClock = {
      blackMs: 1,
      incrementMs: 0,
      running: 'w',
      turnStartedAt: null,
      whiteMs: 1,
    };
    expect(() => clockViewAt(inconsistent, time.now())).toThrow(
      GameDomainError,
    );

    const overflowing = resumeClock(
      {
        blackMs: 1,
        incrementMs: 1,
        running: null,
        turnStartedAt: null,
        whiteMs: Number.MAX_SAFE_INTEGER,
      },
      'w',
      time.now(),
    );
    expect(() => admitMoveOnClock(overflowing, 'w', time.now())).toThrow(
      GameDomainError,
    );
  });
});
