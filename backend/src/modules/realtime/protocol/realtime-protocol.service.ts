import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../common/config/app-config.service.js';
import {
  CLIENT_EVENT_NAMES,
  PROTOCOL_VERSION,
  type ClientEventName,
  type ServerEventName,
} from './protocol.constants.js';
import { RealtimeError } from './realtime.errors.js';
import {
  clientEnvelopeSchema,
  realtimeAckSchema,
  serverEnvelopeSchema,
  type ClientEventEnvelope,
  type ProtocolErrorPayload,
  type RealtimeAck,
  type ServerEventEnvelope,
} from './protocol.schemas.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ServerEventDraft {
  clientMoveId?: string;
  correlationId?: string;
  gameId?: string;
  gameVersion?: number;
  payload: unknown;
  type: ServerEventName;
}

@Injectable()
export class RealtimeProtocolService {
  private readonly maxPayloadBytes: number;

  constructor(config: AppConfigService) {
    this.maxPayloadBytes = config.values.MAX_WS_BUFFER_BYTES;
  }

  parseClientEvent(
    eventName: string,
    rawEnvelope: unknown,
  ): ClientEventEnvelope {
    if (!this.isSupportedClientEvent(eventName)) {
      throw new RealtimeError(
        'UNSUPPORTED_EVENT',
        'Socket event is not supported',
        false,
      );
    }
    if (this.encodedSize(rawEnvelope) > this.maxPayloadBytes) {
      throw new RealtimeError(
        'INVALID_PAYLOAD',
        'Socket event exceeds the payload limit',
        false,
      );
    }
    if (
      typeof rawEnvelope === 'object' &&
      rawEnvelope !== null &&
      'protocolVersion' in rawEnvelope &&
      rawEnvelope.protocolVersion !== PROTOCOL_VERSION
    ) {
      throw new RealtimeError(
        'UNSUPPORTED_PROTOCOL_VERSION',
        'Socket protocol version is not supported',
        false,
      );
    }
    if (
      typeof rawEnvelope === 'object' &&
      rawEnvelope !== null &&
      'type' in rawEnvelope &&
      rawEnvelope.type !== eventName
    ) {
      throw new RealtimeError(
        'INVALID_PAYLOAD',
        'Socket event name and envelope type must match',
        false,
      );
    }

    const parsed = clientEnvelopeSchema.safeParse(rawEnvelope);
    if (!parsed.success) {
      throw new RealtimeError(
        'INVALID_PAYLOAD',
        'Socket event payload is invalid',
        false,
      );
    }
    return parsed.data;
  }

  createServerEvent(draft: ServerEventDraft): ServerEventEnvelope {
    return serverEnvelopeSchema.parse({
      ...draft,
      eventId: randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      timestamp: Date.now(),
    });
  }

  createSuccessAck(
    requestEventId: string,
    correlationId: string,
    type: RealtimeAck extends infer Ack
      ? Ack extends { ok: true; type: infer Type }
        ? Type
        : never
      : never,
    payload: unknown,
    gameVersion?: number,
  ): RealtimeAck {
    return realtimeAckSchema.parse({
      correlationId,
      ...(gameVersion === undefined ? {} : { gameVersion }),
      ok: true,
      payload,
      protocolVersion: PROTOCOL_VERSION,
      requestEventId,
      type,
    });
  }

  createFailureAck(
    requestEventId: string,
    correlationId: string,
    error: ProtocolErrorPayload,
    type: 'move.rejected' | 'server.error' = 'server.error',
    gameVersion?: number,
  ): RealtimeAck {
    return realtimeAckSchema.parse({
      correlationId,
      error,
      ...(gameVersion === undefined ? {} : { gameVersion }),
      ok: false,
      protocolVersion: PROTOCOL_VERSION,
      requestEventId,
      type,
    });
  }

  correlationId(value: unknown): string {
    return typeof value === 'string' && UUID_V4.test(value)
      ? value.toLowerCase()
      : randomUUID();
  }

  requestEventId(rawEnvelope: unknown): string {
    if (
      typeof rawEnvelope === 'object' &&
      rawEnvelope !== null &&
      'eventId' in rawEnvelope &&
      typeof rawEnvelope.eventId === 'string' &&
      UUID_V4.test(rawEnvelope.eventId)
    ) {
      return rawEnvelope.eventId.toLowerCase();
    }
    return randomUUID();
  }

  private encodedSize(value: unknown): number {
    try {
      if (
        value === undefined ||
        typeof value === 'function' ||
        typeof value === 'symbol'
      ) {
        throw new Error('Payload cannot be encoded');
      }
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
      throw new RealtimeError(
        'INVALID_PAYLOAD',
        'Socket event payload is invalid',
        false,
      );
    }
  }

  private isSupportedClientEvent(value: string): value is ClientEventName {
    return (CLIENT_EVENT_NAMES as readonly string[]).includes(value);
  }
}
