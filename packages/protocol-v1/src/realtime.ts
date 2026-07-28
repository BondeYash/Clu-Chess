import { z } from "zod";

import { PROTOCOL_ERROR_CODES, PROTOCOL_VERSION } from "./constants.js";

const uuidV4 = z.uuidv4();
const epochMs = z.number().int().nonnegative();
const gameVersion = z.number().int().nonnegative();
const clockMs = z.number().int().nonnegative();
const emptyPayload = z.object({}).strict();

const clientFields = {
  correlationId: uuidV4.optional(),
  eventId: uuidV4,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  timestamp: epochMs,
} as const;

const serverFields = {
  correlationId: uuidV4.optional(),
  eventId: uuidV4,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  timestamp: epochMs,
} as const;

export const queueJoinEnvelopeSchema = z
  .object({
    ...clientFields,
    payload: z.object({ mode: z.literal("blitz") }).strict(),
    type: z.literal("queue.join"),
  })
  .strict();

export const queueLeaveEnvelopeSchema = z
  .object({
    ...clientFields,
    payload: z.object({ mode: z.literal("blitz") }).strict(),
    type: z.literal("queue.leave"),
  })
  .strict();

export const gameReadyEnvelopeSchema = z
  .object({
    ...clientFields,
    gameId: uuidV4,
    gameVersion,
    payload: emptyPayload,
    type: z.literal("game.ready"),
  })
  .strict();

export const moveSubmitEnvelopeSchema = z
  .object({
    ...clientFields,
    clientMoveId: uuidV4,
    gameId: uuidV4,
    gameVersion,
    payload: z
      .object({
        from: z.string().regex(/^[a-h][1-8]$/),
        promotion: z.enum(["q", "r", "b", "n"]).optional(),
        to: z.string().regex(/^[a-h][1-8]$/),
      })
      .strict(),
    type: z.literal("move.submit"),
  })
  .strict();

export const gameResignEnvelopeSchema = z
  .object({
    ...clientFields,
    gameId: uuidV4,
    gameVersion,
    payload: emptyPayload,
    type: z.literal("game.resign"),
  })
  .strict();

export const gameSyncEnvelopeSchema = z
  .object({
    ...clientFields,
    gameId: uuidV4.optional(),
    gameVersion: gameVersion.optional(),
    payload: emptyPayload,
    type: z.literal("game.sync"),
  })
  .strict();

export const heartbeatPingEnvelopeSchema = z
  .object({
    ...clientFields,
    payload: z
      .object({
        lastKnownGameVersion: gameVersion.optional(),
      })
      .strict(),
    type: z.literal("heartbeat.ping"),
  })
  .strict();

export const clientEnvelopeSchema = z.discriminatedUnion("type", [
  queueJoinEnvelopeSchema,
  queueLeaveEnvelopeSchema,
  gameReadyEnvelopeSchema,
  moveSubmitEnvelopeSchema,
  gameResignEnvelopeSchema,
  gameSyncEnvelopeSchema,
  heartbeatPingEnvelopeSchema,
]);

export type ClientEventEnvelope = Readonly<
  z.infer<typeof clientEnvelopeSchema>
>;

export const protocolErrorSchema = z
  .object({
    authoritativeVersion: gameVersion.optional(),
    code: z.enum(PROTOCOL_ERROR_CODES),
    message: z.string().min(1).max(256),
    retryAfterMs: z.number().int().positive().optional(),
    retryable: z.boolean(),
  })
  .strict();

export type ProtocolErrorPayload = Readonly<
  z.infer<typeof protocolErrorSchema>
>;

export const colorSchema = z.enum(["white", "black"]);
export const gameStatusSchema = z.enum([
  "CREATED",
  "WAITING_FOR_PLAYERS",
  "READY",
  "IN_PROGRESS",
  "RECONNECTING",
  "COMPLETED",
  "ABANDONED",
  "EXPIRED",
]);
export const resultSchema = z.enum(["white_win", "black_win", "draw", "void"]);
export const terminationSchema = z.enum([
  "checkmate",
  "stalemate",
  "insufficient_material",
  "threefold_repetition",
  "fifty_move",
  "resignation",
  "timeout",
  "abandonment",
  "double_abandon",
  "no_show",
]);
export const clocksSchema = z
  .object({
    blackMs: clockMs,
    running: colorSchema.nullable(),
    serverTime: epochMs,
    whiteMs: clockMs,
  })
  .strict();
export const publicPlayerSchema = z
  .object({
    avatar: z.string().min(1).max(128),
    color: colorSchema,
    connected: z.boolean(),
    name: z.string().min(1).max(128),
  })
  .strict();

export const sessionReadyPayloadSchema = z
  .object({
    activeGameId: uuidV4.nullable(),
    guest: z
      .object({
        avatar: z.string().min(1).max(128),
        expiresAt: z.iso.datetime(),
        id: uuidV4,
        name: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();

export const queueJoinedPayloadSchema = z
  .object({
    mode: z.literal("blitz"),
    position: z.number().int().positive().optional(),
    since: epochMs,
  })
  .strict();

export const queueLeftPayloadSchema = z
  .object({
    mode: z.literal("blitz"),
    reason: z.enum([
      "requested",
      "matched",
      "disconnected",
      "timeout",
      "stale",
    ]),
  })
  .strict();

export const matchFoundPayloadSchema = z
  .object({
    color: colorSchema,
    joinDeadline: epochMs,
    opponent: z
      .object({
        avatar: z.string().min(1).max(128),
        name: z.string().min(1).max(128),
      })
      .strict(),
    timeControl: z
      .object({
        incrementMs: clockMs,
        initialMs: clockMs,
      })
      .strict(),
  })
  .strict();

export const gameSnapshotPayloadSchema = z
  .object({
    clocks: clocksSchema,
    currentFen: z.string().min(1).max(256),
    initialFen: z.string().min(1).max(256),
    moves: z.array(
      z
        .object({
          color: colorSchema,
          ply: z.number().int().positive(),
          san: z.string().min(1).max(32),
          uci: z.string().min(4).max(5),
        })
        .strict(),
    ),
    opponent: publicPlayerSchema,
    result: resultSchema.nullable(),
    status: gameStatusSchema,
    termination: terminationSchema.nullable(),
    turn: colorSchema,
    you: publicPlayerSchema,
  })
  .strict();

export const gameStartedPayloadSchema = z
  .object({
    clocks: z
      .object({
        blackMs: clockMs,
        running: z.literal("white"),
        serverTime: epochMs,
        whiteMs: clockMs,
      })
      .strict(),
    initialFen: z.string().min(1).max(256),
    turn: z.literal("white"),
  })
  .strict();

export const moveAcceptedPayloadSchema = z
  .object({
    check: z.boolean(),
    clocks: clocksSchema,
    fenAfter: z.string().min(1).max(256),
    ply: z.number().int().positive(),
    san: z.string().min(1).max(32),
    turn: colorSchema,
    uci: z.string().min(4).max(5),
  })
  .strict();

export const playerDisconnectedPayloadSchema = z
  .object({
    clocksContinue: z.literal(true),
    color: colorSchema,
    graceDeadline: epochMs,
  })
  .strict();

export const playerReconnectedPayloadSchema = z
  .object({ color: colorSchema })
  .strict();

export const gameEndedPayloadSchema = z
  .object({
    clocks: z
      .object({
        blackMs: clockMs,
        running: z.null(),
        serverTime: epochMs,
        whiteMs: clockMs,
      })
      .strict(),
    finalFen: z.string().min(1).max(256),
    pgn: z.string().max(16_384),
    result: resultSchema,
    termination: terminationSchema,
  })
  .strict();

export const heartbeatPongPayloadSchema = z
  .object({
    presenceExpiresInMs: z.number().int().positive(),
    serverTime: epochMs,
  })
  .strict();

const sessionReadyEnvelopeSchema = z
  .object({
    ...serverFields,
    payload: sessionReadyPayloadSchema,
    type: z.literal("session.ready"),
  })
  .strict();
const queueJoinedEnvelopeSchema = z
  .object({
    ...serverFields,
    payload: queueJoinedPayloadSchema,
    type: z.literal("queue.joined"),
  })
  .strict();
const queueLeftEnvelopeSchema = z
  .object({
    ...serverFields,
    payload: queueLeftPayloadSchema,
    type: z.literal("queue.left"),
  })
  .strict();
const matchFoundEnvelopeSchema = gameServerEnvelope(
  "match.found",
  matchFoundPayloadSchema,
);
const gameSnapshotEnvelopeSchema = gameServerEnvelope(
  "game.snapshot",
  gameSnapshotPayloadSchema,
);
const gameStartedEnvelopeSchema = gameServerEnvelope(
  "game.started",
  gameStartedPayloadSchema,
);
const moveAcceptedEnvelopeSchema = z
  .object({
    ...serverFields,
    clientMoveId: uuidV4,
    gameId: uuidV4,
    gameVersion,
    payload: moveAcceptedPayloadSchema,
    type: z.literal("move.accepted"),
  })
  .strict();
const moveRejectedEnvelopeSchema = z
  .object({
    ...serverFields,
    clientMoveId: uuidV4,
    gameId: uuidV4,
    gameVersion,
    payload: protocolErrorSchema,
    type: z.literal("move.rejected"),
  })
  .strict();
const playerDisconnectedEnvelopeSchema = gameServerEnvelope(
  "player.disconnected",
  playerDisconnectedPayloadSchema,
);
const playerReconnectedEnvelopeSchema = gameServerEnvelope(
  "player.reconnected",
  playerReconnectedPayloadSchema,
);
const gameEndedEnvelopeSchema = gameServerEnvelope(
  "game.ended",
  gameEndedPayloadSchema,
);
const heartbeatPongEnvelopeSchema = z
  .object({
    ...serverFields,
    payload: heartbeatPongPayloadSchema,
    type: z.literal("heartbeat.pong"),
  })
  .strict();
const serverErrorEnvelopeSchema = z
  .object({
    ...serverFields,
    clientMoveId: uuidV4.optional(),
    gameId: uuidV4.optional(),
    gameVersion: gameVersion.optional(),
    payload: protocolErrorSchema,
    type: z.literal("server.error"),
  })
  .strict();

export const serverEnvelopeSchema = z.discriminatedUnion("type", [
  sessionReadyEnvelopeSchema,
  queueJoinedEnvelopeSchema,
  queueLeftEnvelopeSchema,
  matchFoundEnvelopeSchema,
  gameSnapshotEnvelopeSchema,
  gameStartedEnvelopeSchema,
  moveAcceptedEnvelopeSchema,
  moveRejectedEnvelopeSchema,
  playerDisconnectedEnvelopeSchema,
  playerReconnectedEnvelopeSchema,
  gameEndedEnvelopeSchema,
  heartbeatPongEnvelopeSchema,
  serverErrorEnvelopeSchema,
]);

export type ServerEventEnvelope = Readonly<
  z.infer<typeof serverEnvelopeSchema>
>;

const ackFields = {
  correlationId: uuidV4,
  ok: z.literal(true),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestEventId: uuidV4,
} as const;

const ackSuccessSchemas = [
  ackSuccess("session.ready", sessionReadyPayloadSchema),
  ackSuccess("queue.joined", queueJoinedPayloadSchema),
  ackSuccess("queue.left", queueLeftPayloadSchema),
  ackSuccess("game.snapshot", gameSnapshotPayloadSchema, true),
  ackSuccess("move.accepted", moveAcceptedPayloadSchema, true),
  ackSuccess("game.ended", gameEndedPayloadSchema, true),
  ackSuccess("heartbeat.pong", heartbeatPongPayloadSchema),
] as const;

export const ackSuccessSchema = z.discriminatedUnion("type", ackSuccessSchemas);

export const ackFailureSchema = z
  .object({
    correlationId: uuidV4,
    error: protocolErrorSchema,
    gameVersion: gameVersion.optional(),
    ok: z.literal(false),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestEventId: uuidV4,
    type: z.enum(["server.error", "move.rejected"]),
  })
  .strict();

export const realtimeAckSchema = z.union([ackSuccessSchema, ackFailureSchema]);

export type RealtimeAck = Readonly<z.infer<typeof realtimeAckSchema>>;

// A concrete Zod object type is required by discriminated unions.
function gameServerEnvelope<
  Type extends
    | "match.found"
    | "game.snapshot"
    | "game.started"
    | "player.disconnected"
    | "player.reconnected"
    | "game.ended",
  Payload extends z.ZodType,
>(type: Type, payload: Payload) {
  return z
    .object({
      ...serverFields,
      gameId: uuidV4,
      gameVersion,
      payload,
      type: z.literal(type),
    })
    .strict();
}

// A concrete Zod object type is required by discriminated unions.
function ackSuccess<
  Type extends
    | "session.ready"
    | "queue.joined"
    | "queue.left"
    | "game.snapshot"
    | "move.accepted"
    | "game.ended"
    | "heartbeat.pong",
  Payload extends z.ZodType,
>(type: Type, payload: Payload, requiresGameVersion = false) {
  return z
    .object({
      ...ackFields,
      ...(requiresGameVersion ? { gameVersion } : {}),
      payload,
      type: z.literal(type),
    })
    .strict();
}

/*
 * Browser receive schemas intentionally strip additive fields at every object
 * boundary. The backend-facing schemas above remain strict so commands and
 * server emissions cannot drift silently.
 */
const clientProtocolErrorSchema = z.object({
  authoritativeVersion: gameVersion.optional(),
  code: z.enum(PROTOCOL_ERROR_CODES),
  message: z.string().min(1).max(256),
  retryAfterMs: z.number().int().positive().optional(),
  retryable: z.boolean(),
});
const clientClocksSchema = z.object({
  blackMs: clockMs,
  running: colorSchema.nullable(),
  serverTime: epochMs,
  whiteMs: clockMs,
});
const clientPublicPlayerSchema = z.object({
  avatar: z.string().min(1).max(128),
  color: colorSchema,
  connected: z.boolean(),
  name: z.string().min(1).max(128),
});

export const clientSessionReadyPayloadSchema = z.object({
  activeGameId: uuidV4.nullable(),
  guest: z.object({
    avatar: z.string().min(1).max(128),
    expiresAt: z.iso.datetime(),
    id: uuidV4,
    name: z.string().min(1).max(128),
  }),
});
export const clientQueueJoinedPayloadSchema = z.object({
  mode: z.literal("blitz"),
  position: z.number().int().positive().optional(),
  since: epochMs,
});
export const clientQueueLeftPayloadSchema = z.object({
  mode: z.literal("blitz"),
  reason: z.enum(["requested", "matched", "disconnected", "timeout", "stale"]),
});
export const clientMatchFoundPayloadSchema = z.object({
  color: colorSchema,
  joinDeadline: epochMs,
  opponent: z.object({
    avatar: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
  }),
  timeControl: z.object({
    incrementMs: clockMs,
    initialMs: clockMs,
  }),
});
export const clientGameSnapshotPayloadSchema = z.object({
  clocks: clientClocksSchema,
  currentFen: z.string().min(1).max(256),
  initialFen: z.string().min(1).max(256),
  moves: z.array(
    z.object({
      color: colorSchema,
      ply: z.number().int().positive(),
      san: z.string().min(1).max(32),
      uci: z.string().min(4).max(5),
    }),
  ),
  opponent: clientPublicPlayerSchema,
  result: resultSchema.nullable(),
  status: gameStatusSchema,
  termination: terminationSchema.nullable(),
  turn: colorSchema,
  you: clientPublicPlayerSchema,
});
export const clientGameStartedPayloadSchema = z.object({
  clocks: z.object({
    blackMs: clockMs,
    running: z.literal("white"),
    serverTime: epochMs,
    whiteMs: clockMs,
  }),
  initialFen: z.string().min(1).max(256),
  turn: z.literal("white"),
});
export const clientMoveAcceptedPayloadSchema = z.object({
  check: z.boolean(),
  clocks: clientClocksSchema,
  fenAfter: z.string().min(1).max(256),
  ply: z.number().int().positive(),
  san: z.string().min(1).max(32),
  turn: colorSchema,
  uci: z.string().min(4).max(5),
});
export const clientPlayerDisconnectedPayloadSchema = z.object({
  clocksContinue: z.literal(true),
  color: colorSchema,
  graceDeadline: epochMs,
});
export const clientPlayerReconnectedPayloadSchema = z.object({
  color: colorSchema,
});
export const clientGameEndedPayloadSchema = z.object({
  clocks: z.object({
    blackMs: clockMs,
    running: z.null(),
    serverTime: epochMs,
    whiteMs: clockMs,
  }),
  finalFen: z.string().min(1).max(256),
  pgn: z.string().max(16_384),
  result: resultSchema,
  termination: terminationSchema,
});
export const clientHeartbeatPongPayloadSchema = z.object({
  presenceExpiresInMs: z.number().int().positive(),
  serverTime: epochMs,
});

const clientServerFields = {
  correlationId: uuidV4.optional(),
  eventId: uuidV4,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  timestamp: epochMs,
} as const;

const clientServerEnvelopeSchemas = [
  clientServerEnvelope("session.ready", clientSessionReadyPayloadSchema),
  clientServerEnvelope("queue.joined", clientQueueJoinedPayloadSchema),
  clientServerEnvelope("queue.left", clientQueueLeftPayloadSchema),
  clientGameServerEnvelope("match.found", clientMatchFoundPayloadSchema),
  clientGameServerEnvelope("game.snapshot", clientGameSnapshotPayloadSchema),
  clientGameServerEnvelope("game.started", clientGameStartedPayloadSchema),
  z.object({
    ...clientServerFields,
    clientMoveId: uuidV4,
    gameId: uuidV4,
    gameVersion,
    payload: clientMoveAcceptedPayloadSchema,
    type: z.literal("move.accepted"),
  }),
  z.object({
    ...clientServerFields,
    clientMoveId: uuidV4,
    gameId: uuidV4,
    gameVersion,
    payload: clientProtocolErrorSchema,
    type: z.literal("move.rejected"),
  }),
  clientGameServerEnvelope(
    "player.disconnected",
    clientPlayerDisconnectedPayloadSchema,
  ),
  clientGameServerEnvelope(
    "player.reconnected",
    clientPlayerReconnectedPayloadSchema,
  ),
  clientGameServerEnvelope("game.ended", clientGameEndedPayloadSchema),
  clientServerEnvelope("heartbeat.pong", clientHeartbeatPongPayloadSchema),
  z.object({
    ...clientServerFields,
    clientMoveId: uuidV4.optional(),
    gameId: uuidV4.optional(),
    gameVersion: gameVersion.optional(),
    payload: clientProtocolErrorSchema,
    type: z.literal("server.error"),
  }),
] as const;

export const clientServerEnvelopeSchema = z.discriminatedUnion(
  "type",
  clientServerEnvelopeSchemas,
);

export type ClientReceivedServerEventEnvelope = Readonly<
  z.infer<typeof clientServerEnvelopeSchema>
>;

const clientAckFields = {
  correlationId: uuidV4,
  ok: z.literal(true),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestEventId: uuidV4,
} as const;

export const clientRealtimeAckSchema = z.union([
  z.discriminatedUnion("type", [
    clientAckSuccess("session.ready", clientSessionReadyPayloadSchema),
    clientAckSuccess("queue.joined", clientQueueJoinedPayloadSchema),
    clientAckSuccess("queue.left", clientQueueLeftPayloadSchema),
    clientAckSuccess("game.snapshot", clientGameSnapshotPayloadSchema, true),
    clientAckSuccess("move.accepted", clientMoveAcceptedPayloadSchema, true),
    clientAckSuccess("game.ended", clientGameEndedPayloadSchema, true),
    clientAckSuccess("heartbeat.pong", clientHeartbeatPongPayloadSchema),
  ]),
  z.object({
    correlationId: uuidV4,
    error: clientProtocolErrorSchema,
    gameVersion: gameVersion.optional(),
    ok: z.literal(false),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestEventId: uuidV4,
    type: z.enum(["server.error", "move.rejected"]),
  }),
]);

export type ClientReceivedRealtimeAck = Readonly<
  z.infer<typeof clientRealtimeAckSchema>
>;

function clientServerEnvelope<Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
) {
  return z.object({
    ...clientServerFields,
    payload,
    type: z.literal(type),
  });
}

function clientGameServerEnvelope<
  Type extends string,
  Payload extends z.ZodType,
>(type: Type, payload: Payload) {
  return z.object({
    ...clientServerFields,
    gameId: uuidV4,
    gameVersion,
    payload,
    type: z.literal(type),
  });
}

function clientAckSuccess<Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
  requiresGameVersion = false,
) {
  return z.object({
    ...clientAckFields,
    ...(requiresGameVersion ? { gameVersion } : {}),
    payload,
    type: z.literal(type),
  });
}
