import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../src/common/config/app-config.service.js';
import { parseEnvironment } from '../../src/common/config/config.schema.js';
import {
  CLIENT_EVENT_NAMES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
} from '../../src/modules/realtime/protocol/protocol.constants.js';
import {
  clientEnvelopeSchema,
  realtimeAckSchema,
  serverEnvelopeSchema,
} from '../../src/modules/realtime/protocol/protocol.schemas.js';
import { RealtimeProtocolService } from '../../src/modules/realtime/protocol/realtime-protocol.service.js';
import { RealtimeError } from '../../src/modules/realtime/protocol/realtime.errors.js';

const now = Date.now();

describe('realtime protocol v1', () => {
  const protocol = new RealtimeProtocolService(
    new AppConfigService(parseEnvironment({})),
  );

  it('strictly validates every client event', () => {
    const gameId = randomUUID();
    const fixtures: readonly unknown[] = [
      client('queue.join', { mode: 'blitz' }),
      client('queue.leave', { mode: 'blitz' }),
      { ...client('game.ready', {}), gameId, gameVersion: 0 },
      {
        ...client('move.submit', { from: 'e2', to: 'e4' }),
        clientMoveId: randomUUID(),
        gameId,
        gameVersion: 1,
      },
      { ...client('game.resign', {}), gameId, gameVersion: 1 },
      { ...client('game.sync', {}), gameId, gameVersion: 1 },
      client('heartbeat.ping', { lastKnownGameVersion: 1 }),
    ];

    expect(
      fixtures.map((fixture) => clientEnvelopeSchema.parse(fixture).type),
    ).toEqual(CLIENT_EVENT_NAMES);
    expect(() =>
      clientEnvelopeSchema.parse({
        ...client('queue.join', { mode: 'blitz' }),
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      clientEnvelopeSchema.parse(
        client('move.submit', { from: 'z9', to: 'e4' }),
      ),
    ).toThrow();
  });

  it('strictly validates every server event', () => {
    const gameId = randomUUID();
    const gameVersion = 2;
    const clocks = {
      blackMs: 299_000,
      running: 'black',
      serverTime: now,
      whiteMs: 301_000,
    };
    const player = {
      avatar: 'pawn',
      color: 'white',
      connected: true,
      name: 'SwiftKnight42',
    };
    const game = { gameId, gameVersion };
    const error = {
      code: 'ILLEGAL_MOVE',
      message: 'Move is illegal',
      retryable: false,
    };
    const fixtures: readonly unknown[] = [
      server('session.ready', {
        activeGameId: null,
        guest: {
          avatar: 'pawn',
          expiresAt: new Date(now + 60_000).toISOString(),
          id: randomUUID(),
          name: 'SwiftKnight42',
        },
      }),
      server('queue.joined', { mode: 'blitz', since: now }),
      server('queue.left', { mode: 'blitz', reason: 'requested' }),
      {
        ...server('match.found', {
          color: 'white',
          joinDeadline: now + 20_000,
          opponent: { avatar: 'rook', name: 'CalmRook88' },
          timeControl: { incrementMs: 2000, initialMs: 300_000 },
        }),
        ...game,
      },
      {
        ...server('game.snapshot', {
          clocks,
          currentFen: 'start',
          initialFen: 'start',
          moves: [],
          opponent: { ...player, color: 'black' },
          result: null,
          status: 'IN_PROGRESS',
          termination: null,
          turn: 'black',
          you: player,
        }),
        ...game,
      },
      {
        ...server('game.started', {
          clocks: { ...clocks, running: 'white' },
          initialFen: 'start',
          turn: 'white',
        }),
        ...game,
      },
      {
        ...server('move.accepted', {
          check: false,
          clocks,
          fenAfter: 'after',
          ply: 1,
          san: 'e4',
          turn: 'black',
          uci: 'e2e4',
        }),
        ...game,
        clientMoveId: randomUUID(),
      },
      {
        ...server('move.rejected', error),
        ...game,
        clientMoveId: randomUUID(),
      },
      {
        ...server('player.disconnected', {
          clocksContinue: true,
          color: 'black',
          graceDeadline: now + 30_000,
        }),
        ...game,
      },
      {
        ...server('player.reconnected', { color: 'black' }),
        ...game,
      },
      {
        ...server('game.ended', {
          clocks: { ...clocks, running: null },
          finalFen: 'final',
          pgn: '1. e4',
          result: 'white_win',
          termination: 'resignation',
        }),
        ...game,
      },
      server('heartbeat.pong', {
        presenceExpiresInMs: 45_000,
        serverTime: now,
      }),
      server('server.error', error),
    ];

    expect(
      fixtures.map((fixture) => serverEnvelopeSchema.parse(fixture).type),
    ).toEqual(SERVER_EVENT_NAMES);
  });

  it('enforces names, versions, payload size, and safe encodability', () => {
    const valid = client('heartbeat.ping', {});
    expect(protocol.parseClientEvent('heartbeat.ping', valid)).toEqual(valid);
    expectRealtimeCode(
      () => protocol.parseClientEvent('unknown.event', valid),
      'UNSUPPORTED_EVENT',
    );
    expectRealtimeCode(
      () =>
        protocol.parseClientEvent('heartbeat.ping', {
          ...valid,
          type: 'game.sync',
        }),
      'INVALID_PAYLOAD',
    );
    expectRealtimeCode(
      () =>
        protocol.parseClientEvent('heartbeat.ping', {
          ...valid,
          protocolVersion: 2,
        }),
      'UNSUPPORTED_PROTOCOL_VERSION',
    );
    expectRealtimeCode(
      () =>
        protocol.parseClientEvent(
          'heartbeat.ping',
          client('heartbeat.ping', { value: 'x'.repeat(8192) }),
        ),
      'INVALID_PAYLOAD',
    );
    expectRealtimeCode(
      () => protocol.parseClientEvent('heartbeat.ping', undefined),
      'INVALID_PAYLOAD',
    );
    expectRealtimeCode(
      () => protocol.parseClientEvent('heartbeat.ping', 1n),
      'INVALID_PAYLOAD',
    );
  });

  it('creates correlated, schema-validated server events and acknowledgements', () => {
    const requestEventId = randomUUID();
    const correlationId = randomUUID();
    const success = protocol.createSuccessAck(
      requestEventId,
      correlationId,
      'heartbeat.pong',
      { presenceExpiresInMs: 45_000, serverTime: now },
    );
    const failure = protocol.createFailureAck(requestEventId, correlationId, {
      code: 'RATE_LIMITED',
      message: 'Try later',
      retryAfterMs: 50,
      retryable: true,
    });
    const event = protocol.createServerEvent({
      correlationId,
      payload: { presenceExpiresInMs: 45_000, serverTime: now },
      type: 'heartbeat.pong',
    });

    expect(realtimeAckSchema.parse(success)).toMatchObject({
      correlationId,
      ok: true,
      requestEventId,
    });
    expect(realtimeAckSchema.parse(failure)).toMatchObject({
      correlationId,
      ok: false,
      requestEventId,
    });
    expect(event).toMatchObject({
      correlationId,
      protocolVersion: PROTOCOL_VERSION,
      type: 'heartbeat.pong',
    });
    expect(event.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('normalizes valid IDs and replaces invalid boundary values', () => {
    const valid = randomUUID().toUpperCase();
    expect(protocol.correlationId(valid)).toBe(valid.toLowerCase());
    expect(protocol.correlationId('invalid')).not.toBe('invalid');
    expect(protocol.requestEventId({ eventId: valid })).toBe(
      valid.toLowerCase(),
    );
    expect(protocol.requestEventId({})).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

function client(type: string, payload: unknown): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    payload,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: now,
    type,
  };
}

function server(type: string, payload: unknown): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    payload,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: now,
    type,
  };
}

function expectRealtimeCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected realtime error');
  } catch (error) {
    expect(error).toBeInstanceOf(RealtimeError);
    expect((error as RealtimeError).code).toBe(code);
  }
}
