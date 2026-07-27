import { GameDomainError } from './game.errors.js';
import type { PlayerColor } from './game.types.js';
import { oppositeColor } from './game.types.js';

export type GameClock = Readonly<{
  blackMs: number;
  incrementMs: number;
  running: PlayerColor | null;
  turnStartedAt: Date | null;
  whiteMs: number;
}>;

export type ClockView = Readonly<{
  blackMs: number;
  observedAt: Date;
  running: PlayerColor | null;
  whiteMs: number;
}>;

export type ClockAdmission =
  | Readonly<{
      clock: GameClock;
      elapsedMs: number;
      kind: 'accepted';
    }>
  | Readonly<{
      clock: GameClock;
      elapsedMs: number;
      flagged: PlayerColor;
      kind: 'flag_fall';
    }>;

export type PauseClockResult =
  | Readonly<{
      clock: GameClock;
      elapsedMs: number;
      kind: 'paused';
    }>
  | Extract<ClockAdmission, { kind: 'flag_fall' }>;

export function createGameClock(
  initialMs: number,
  incrementMs: number,
): GameClock {
  assertPositiveDuration(initialMs, 'initialMs');
  assertDuration(incrementMs, 'incrementMs');

  return {
    blackMs: initialMs,
    incrementMs,
    running: null,
    turnStartedAt: null,
    whiteMs: initialMs,
  };
}

export function resumeClock(
  clock: GameClock,
  running: PlayerColor,
  startedAt: Date,
): GameClock {
  assertClock(clock);
  assertTimestamp(startedAt);

  if (clock.running !== null || clock.turnStartedAt !== null) {
    throw invalidClock('A running clock cannot be resumed.');
  }

  if (remainingFor(clock, running) === 0) {
    throw invalidClock('A player with no remaining time cannot resume.');
  }

  return {
    ...clock,
    running,
    turnStartedAt: copyDate(startedAt),
  };
}

export function pauseClock(
  clock: GameClock,
  observedAt: Date,
): PauseClockResult {
  const running = requireRunning(clock);
  const elapsedMs = elapsedAt(clock, observedAt);
  const remaining = remainingFor(clock, running);

  if (elapsedMs >= remaining) {
    return flagFallClock(clock, running, elapsedMs);
  }

  return {
    clock: {
      ...withRemaining(clock, running, remaining - elapsedMs),
      running: null,
      turnStartedAt: null,
    },
    elapsedMs,
    kind: 'paused',
  };
}

export function admitMoveOnClock(
  clock: GameClock,
  mover: PlayerColor,
  serverReceivedAt: Date,
): ClockAdmission {
  const running = requireRunning(clock);

  if (running !== mover) {
    throw invalidClock('The mover does not own the running clock.');
  }

  const elapsedMs = elapsedAt(clock, serverReceivedAt);
  const remaining = remainingFor(clock, mover);

  if (elapsedMs >= remaining) {
    return flagFallClock(clock, mover, elapsedMs);
  }

  const afterIncrement = checkedAdd(remaining - elapsedMs, clock.incrementMs);

  return {
    clock: {
      ...withRemaining(clock, mover, afterIncrement),
      running: oppositeColor(mover),
      turnStartedAt: copyDate(serverReceivedAt),
    },
    elapsedMs,
    kind: 'accepted',
  };
}

export function checkFlagFall(
  clock: GameClock,
  observedAt: Date,
): ClockAdmission {
  const running = requireRunning(clock);
  const elapsedMs = elapsedAt(clock, observedAt);
  const remaining = remainingFor(clock, running);

  if (elapsedMs >= remaining) {
    return flagFallClock(clock, running, elapsedMs);
  }

  return {
    clock: cloneClock(clock),
    elapsedMs,
    kind: 'accepted',
  };
}

export function clockViewAt(clock: GameClock, observedAt: Date): ClockView {
  assertClock(clock);
  assertTimestamp(observedAt);

  if (clock.running === null) {
    return {
      blackMs: clock.blackMs,
      observedAt: copyDate(observedAt),
      running: null,
      whiteMs: clock.whiteMs,
    };
  }

  const elapsedMs = elapsedAt(clock, observedAt);
  const remaining = Math.max(0, remainingFor(clock, clock.running) - elapsedMs);
  const viewed = withRemaining(clock, clock.running, remaining);

  return {
    blackMs: viewed.blackMs,
    observedAt: copyDate(observedAt),
    running: clock.running,
    whiteMs: viewed.whiteMs,
  };
}

export function clockDeadline(clock: GameClock): Date | null {
  assertClock(clock);

  if (clock.running === null || clock.turnStartedAt === null) {
    return null;
  }

  return new Date(
    clock.turnStartedAt.getTime() + remainingFor(clock, clock.running),
  );
}

function assertClock(clock: GameClock): void {
  assertDuration(clock.whiteMs, 'whiteMs');
  assertDuration(clock.blackMs, 'blackMs');
  assertDuration(clock.incrementMs, 'incrementMs');

  const hasRunningColor = clock.running !== null;
  const hasStartedAt = clock.turnStartedAt !== null;
  if (hasRunningColor !== hasStartedAt) {
    throw invalidClock(
      'A clock must have both a running color and start time, or neither.',
    );
  }

  if (clock.turnStartedAt !== null) {
    assertTimestamp(clock.turnStartedAt);
  }
}

function assertDuration(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidClock(`${field} must be a non-negative safe integer.`);
  }
}

function assertPositiveDuration(value: number, field: string): void {
  assertDuration(value, field);
  if (value === 0) {
    throw invalidClock(`${field} must be positive.`);
  }
}

function assertTimestamp(timestamp: Date): void {
  if (!Number.isFinite(timestamp.getTime())) {
    throw invalidClock('Clock timestamps must be valid dates.');
  }
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw invalidClock('The calculated clock exceeds the safe integer range.');
  }
  return result;
}

function cloneClock(clock: GameClock): GameClock {
  return {
    ...clock,
    turnStartedAt:
      clock.turnStartedAt === null ? null : copyDate(clock.turnStartedAt),
  };
}

function copyDate(value: Date): Date {
  return new Date(value.getTime());
}

function elapsedAt(clock: GameClock, observedAt: Date): number {
  assertTimestamp(observedAt);
  const startedAt = clock.turnStartedAt;
  if (startedAt === null) {
    throw invalidClock('The clock has no running timestamp.');
  }

  return Math.max(0, Math.trunc(observedAt.getTime() - startedAt.getTime()));
}

function flagFallClock(
  clock: GameClock,
  flagged: PlayerColor,
  elapsedMs: number,
): Extract<ClockAdmission, { kind: 'flag_fall' }> {
  return {
    clock: {
      ...withRemaining(clock, flagged, 0),
      running: null,
      turnStartedAt: null,
    },
    elapsedMs,
    flagged,
    kind: 'flag_fall',
  };
}

function invalidClock(message: string): GameDomainError {
  return new GameDomainError('INVALID_CLOCK_STATE', message);
}

function remainingFor(clock: GameClock, color: PlayerColor): number {
  return color === 'w' ? clock.whiteMs : clock.blackMs;
}

function requireRunning(clock: GameClock): PlayerColor {
  assertClock(clock);
  if (clock.running === null) {
    throw invalidClock('The clock is not running.');
  }
  return clock.running;
}

function withRemaining(
  clock: GameClock,
  color: PlayerColor,
  remainingMs: number,
): GameClock {
  return color === 'w'
    ? { ...clock, whiteMs: remainingMs }
    : { ...clock, blackMs: remainingMs };
}
