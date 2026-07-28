export const PROTOCOL_VERSION = 1 as const;

export const CLIENT_EVENT_NAMES = [
  "queue.join",
  "queue.leave",
  "game.ready",
  "move.submit",
  "game.resign",
  "game.sync",
  "heartbeat.ping",
] as const;

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

export const SERVER_EVENT_NAMES = [
  "session.ready",
  "queue.joined",
  "queue.left",
  "match.found",
  "game.snapshot",
  "game.started",
  "move.accepted",
  "move.rejected",
  "player.disconnected",
  "player.reconnected",
  "game.ended",
  "heartbeat.pong",
  "server.error",
] as const;

export type ServerEventName = (typeof SERVER_EVENT_NAMES)[number];

export const PROTOCOL_ERROR_CODES = [
  "UNAUTHORIZED",
  "INVALID_PAYLOAD",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "UNSUPPORTED_EVENT",
  "IDEMPOTENCY_KEY_REUSED",
  "ALREADY_QUEUED",
  "ALREADY_IN_GAME",
  "GAME_NOT_FOUND",
  "GAME_ALREADY_ENDED",
  "NOT_A_PLAYER",
  "NOT_YOUR_TURN",
  "ILLEGAL_MOVE",
  "STALE_GAME_VERSION",
  "CLOCK_EXPIRED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];
