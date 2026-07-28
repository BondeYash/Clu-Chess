import { describe, expect, it } from "vitest";

import {
  CLIENT_EVENT_NAMES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
} from "../src/constants.js";
import {
  clientCreateSessionResponseSchema,
  clientHttpErrorResponseSchema,
  createSessionResponseSchema,
  httpErrorResponseSchema,
} from "../src/http.js";
import {
  clientServerEnvelopeSchema,
  moveSubmitEnvelopeSchema,
  serverEnvelopeSchema,
} from "../src/realtime.js";

const eventId = "2f1e8308-e0bf-40d2-9ad1-c327abdc47f6";
const guestId = "52fde13e-4f00-4a81-a256-1819f332a0fb";
const gameId = "69b1ed7d-989b-418e-ae0c-8cd7138f2aba";

describe("protocol v1", () => {
  it("publishes the complete event registry", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(CLIENT_EVENT_NAMES).toHaveLength(7);
    expect(SERVER_EVENT_NAMES).toHaveLength(13);
  });

  it("rejects additive command fields at the trust boundary", () => {
    expect(() =>
      moveSubmitEnvelopeSchema.parse({
        clientMoveId: eventId,
        eventId,
        gameId,
        gameVersion: 1,
        payload: { from: "e2", to: "e4", unexpected: true },
        protocolVersion: 1,
        timestamp: 1,
        type: "move.submit",
      }),
    ).toThrow();
  });

  it("keeps backend server emissions strict", () => {
    expect(() =>
      serverEnvelopeSchema.parse({
        eventId,
        payload: {
          presenceExpiresInMs: 10_000,
          serverTime: 1,
          unexpected: true,
        },
        protocolVersion: 1,
        timestamp: 1,
        type: "heartbeat.pong",
      }),
    ).toThrow();
  });

  it("accepts and strips additive fields for browser consumers", () => {
    const parsed = clientServerEnvelopeSchema.parse({
      additiveEnvelopeField: "future",
      eventId,
      payload: {
        additivePayloadField: "future",
        guest: {
          additiveGuestField: "future",
          avatar: "knight",
          expiresAt: "2026-07-28T12:00:00.000Z",
          id: guestId,
          name: "Guest Knight",
        },
        activeGameId: null,
      },
      protocolVersion: 1,
      timestamp: 1,
      type: "session.ready",
    });

    expect(parsed).not.toHaveProperty("additiveEnvelopeField");
    expect(parsed.payload).not.toHaveProperty("additivePayloadField");
    expect(parsed.payload.guest).not.toHaveProperty("additiveGuestField");
  });

  it("uses strict backend and tolerant browser HTTP response schemas", () => {
    const response = {
      additive: "future",
      correlationId: eventId,
      guest: {
        additive: "future",
        avatar: "bishop",
        expiresAt: "2026-07-28T12:00:00.000Z",
        id: guestId,
        name: "Guest Bishop",
      },
      token: "signed-token",
    };

    expect(() => createSessionResponseSchema.parse(response)).toThrow();
    const parsed = clientCreateSessionResponseSchema.parse(response);
    expect(parsed).not.toHaveProperty("additive");
    expect(parsed.guest).not.toHaveProperty("additive");
  });

  it("shares strict and tolerant HTTP error boundaries", () => {
    const response = {
      additive: "future",
      correlationId: eventId,
      error: {
        additive: "future",
        code: "RATE_LIMITED",
        message: "Wait before retrying",
        retryAfterMs: 1_000,
        retryable: true,
      },
    };

    expect(() => httpErrorResponseSchema.parse(response)).toThrow();
    expect(clientHttpErrorResponseSchema.parse(response)).toEqual({
      correlationId: eventId,
      error: {
        code: "RATE_LIMITED",
        message: "Wait before retrying",
        retryAfterMs: 1_000,
        retryable: true,
      },
    });
  });
});
