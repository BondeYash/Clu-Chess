import {
  clientServerEnvelopeSchema,
  moveSubmitEnvelopeSchema,
} from '@cluchess/protocol-v1/realtime';
import { describe, expect, it } from 'vitest';

describe('shared protocol consumer', () => {
  it('compiles strict commands from the shared artifact', () => {
    expect(
      moveSubmitEnvelopeSchema.parse({
        clientMoveId: '2f1e8308-e0bf-40d2-9ad1-c327abdc47f6',
        eventId: 'bb578077-12df-4365-a772-e76f135b91cf',
        gameId: '69b1ed7d-989b-418e-ae0c-8cd7138f2aba',
        gameVersion: 3,
        payload: { from: 'e2', to: 'e4' },
        protocolVersion: 1,
        timestamp: 1_774_697_400_000,
        type: 'move.submit',
      }),
    ).toMatchObject({ type: 'move.submit' });
  });

  it('accepts an additive future field on a received envelope', () => {
    expect(
      clientServerEnvelopeSchema.parse({
        eventId: 'bb578077-12df-4365-a772-e76f135b91cf',
        future: 'ignored',
        payload: {
          presenceExpiresInMs: 15_000,
          serverTime: 1_774_697_400_000,
        },
        protocolVersion: 1,
        timestamp: 1_774_697_400_000,
        type: 'heartbeat.pong',
      }),
    ).not.toHaveProperty('future');
  });
});
