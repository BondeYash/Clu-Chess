import { Inject, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { ExtendedError } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { ApplicationLifecycleService } from '../../common/lifecycle/application-lifecycle.service.js';
import { CorrelationContextService } from '../../common/logging/correlation-context.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { GuestSocketDisconnectRegistry } from '../session/infrastructure/guest-socket-disconnect-registry.js';
import { ActiveGameLookupService } from './active-game-lookup.service.js';
import {
  GUEST_PRESENCE_OBSERVER,
  type GuestPresenceObserver,
} from './application/ports/guest-presence-observer.port.js';
import {
  REALTIME_COMMAND_HANDLER,
  type RealtimeCommandHandler,
  type RealtimeCommandResult,
} from './application/ports/realtime-command-handler.port.js';
import { BroadcastService } from './broadcast.service.js';
import { ConnectionRegistryService } from './connection-registry.service.js';
import { RealtimeProtocolService } from './protocol/realtime-protocol.service.js';
import { PROTOCOL_VERSION } from './protocol/protocol.constants.js';
import { RealtimeError } from './protocol/realtime.errors.js';
import type {
  ClientEventEnvelope,
  ServerEventEnvelope,
} from './protocol/protocol.schemas.js';
import { RealtimeAuthenticationService } from './realtime-authentication.service.js';
import { RealtimeErrorMapperService } from './realtime-error-mapper.service.js';
import { RealtimeRateLimitService } from './realtime-rate-limit.service.js';
import { gameRoom, guestRoom } from './realtime-rooms.js';
import type {
  AuthenticatedSocketIdentity,
  RealtimeAckCallback,
  RealtimeServer,
  RealtimeSocket,
} from './realtime.types.js';

interface SocketHandshakeError extends ExtendedError {
  data?: {
    code: string;
    correlationId: string;
    retryAfterMs?: number;
    retryable: boolean;
  };
}

@WebSocketGateway()
export class RealtimeGateway
  implements
    OnGatewayInit<RealtimeServer>,
    OnGatewayConnection<RealtimeSocket>,
    OnGatewayDisconnect<RealtimeSocket>,
    OnApplicationShutdown
{
  private readonly drainGraceMs: number;
  private readonly drainTimeoutMs: number;
  private readonly transactionTimeoutMs: number;
  private readonly instanceId: string;
  private readonly logger = new Logger(RealtimeGateway.name);
  private server: RealtimeServer | undefined;
  private readonly trackedSockets = new Set<string>();
  private unregisterDrainHook: (() => void) | undefined;

  constructor(
    private readonly activeGames: ActiveGameLookupService,
    private readonly authentication: RealtimeAuthenticationService,
    private readonly broadcast: BroadcastService,
    config: AppConfigService,
    private readonly connections: ConnectionRegistryService,
    private readonly correlation: CorrelationContextService,
    private readonly disconnectRegistry: GuestSocketDisconnectRegistry,
    private readonly errors: RealtimeErrorMapperService,
    private readonly lifecycle: ApplicationLifecycleService,
    private readonly metrics: MetricsService,
    private readonly presence: PresenceService,
    private readonly protocol: RealtimeProtocolService,
    private readonly rateLimits: RealtimeRateLimitService,
    @Inject(REALTIME_COMMAND_HANDLER)
    private readonly commands: RealtimeCommandHandler,
    @Inject(GUEST_PRESENCE_OBSERVER)
    private readonly presenceObserver: GuestPresenceObserver,
  ) {
    this.drainGraceMs = config.values.DRAIN_SOCKET_GRACE_MS;
    this.drainTimeoutMs = config.values.DRAIN_TIMEOUT_MS;
    this.transactionTimeoutMs = config.values.DATABASE_TX_TIMEOUT_MS;
    this.instanceId = config.values.INSTANCE_ID;
    this.publishConnectionMetric();
  }

  afterInit(server: RealtimeServer): void {
    this.server = server;
    this.unregisterDrainHook = this.lifecycle.registerDrainHook(() =>
      this.drainConnections(),
    );
    this.broadcast.bind(server);
    this.disconnectRegistry.bind(this.broadcast);
    server.use((socket, next) => {
      const correlationId = this.protocol.correlationId(
        socket.handshake.headers['x-correlation-id'],
      );
      if (!this.lifecycle.isReady) {
        next(this.drainingHandshakeError(correlationId));
        return;
      }
      void this.authentication
        .authenticate(socket, correlationId)
        .then(() => {
          next();
        })
        .catch((error: unknown) => {
          const mapped = this.errors.map(error);
          const handshakeError = new Error(
            mapped.error.message,
          ) as SocketHandshakeError;
          handshakeError.data = {
            code: mapped.error.code,
            correlationId,
            retryable: mapped.error.retryable,
          };
          next(handshakeError);
        });
    });
  }

  handleConnection(socket: RealtimeSocket): void {
    this.trackedSockets.add(socket.id);
    this.publishConnectionMetric();
    if (!this.lifecycle.isReady) {
      this.emitDrainAdvisory(socket);
      socket.disconnect(true);
      return;
    }
    socket.onAny((eventName: string, ...arguments_: unknown[]) => {
      void this.handleIncoming(socket, eventName, arguments_);
    });
    const finishWork = this.lifecycle.trackWork('realtime');
    void this.initializeSocket(socket).finally(finishWork);
  }

  handleDisconnect(socket: RealtimeSocket): void {
    this.trackedSockets.delete(socket.id);
    this.publishConnectionMetric();
    const finishWork = this.lifecycle.trackWork('realtime');
    void this.cleanUpSocket(socket).finally(finishWork);
  }

  onApplicationShutdown(): void {
    this.unregisterDrainHook?.();
    this.unregisterDrainHook = undefined;
    if (this.server !== undefined) {
      this.broadcast.unbind(this.server);
      this.server = undefined;
    }
    this.trackedSockets.clear();
    this.publishConnectionMetric();
    this.disconnectRegistry.unbind(this.broadcast);
  }

  private async initializeSocket(socket: RealtimeSocket): Promise<void> {
    const identity = this.identity(socket);
    try {
      await socket.join(guestRoom(identity.guestSessionId));
      await this.presenceObserver.reconnected(identity.guestSessionId);
      const event = await this.sessionReadyEvent(
        identity,
        socket.data.correlationId,
      );
      socket.emit(event.type, event);
      if (
        event.type === 'session.ready' &&
        event.payload.activeGameId !== null
      ) {
        await this.emitInitialGameSnapshot(
          socket,
          identity,
          event.payload.activeGameId,
        );
      }
    } catch (error) {
      this.emitServerError(
        socket,
        error,
        socket.data.correlationId ?? this.protocol.correlationId(undefined),
      );
      socket.disconnect(true);
    }
  }

  private async handleIncoming(
    socket: RealtimeSocket,
    eventName: string,
    arguments_: readonly unknown[],
  ): Promise<void> {
    const finishWork = this.lifecycle.trackWork('realtime');
    const rawEnvelope = arguments_[0];
    const acknowledgment =
      typeof arguments_[1] === 'function' && arguments_.length === 2
        ? (arguments_[1] as RealtimeAckCallback)
        : undefined;
    const correlationId = this.protocol.correlationId(
      this.rawCorrelationId(rawEnvelope) ?? socket.data.correlationId,
    );
    const requestEventId = this.protocol.requestEventId(rawEnvelope);

    try {
      await this.correlation.run(correlationId, async () => {
        try {
          if (acknowledgment === undefined) {
            throw new RealtimeError(
              'INVALID_PAYLOAD',
              'Socket command acknowledgment is required',
              false,
            );
          }
          const event = this.protocol.parseClientEvent(eventName, rawEnvelope);
          const identity = this.identity(socket);
          await this.rateLimits.consume(event.type, identity.guestSessionId);
          const result = await this.executeEvent(socket, identity, event);
          acknowledgment(
            this.protocol.createSuccessAck(
              event.eventId,
              correlationId,
              result.type,
              result.payload,
              result.gameVersion,
            ),
          );
        } catch (error) {
          const mapped = this.errors.map(error);
          if (acknowledgment !== undefined) {
            acknowledgment(
              this.protocol.createFailureAck(
                requestEventId,
                correlationId,
                mapped.error,
                mapped.responseType,
                mapped.gameVersion,
              ),
            );
            return;
          }
          this.emitServerError(socket, error, correlationId);
        }
      });
    } finally {
      finishWork();
    }
  }

  private async executeEvent(
    socket: RealtimeSocket,
    identity: Readonly<AuthenticatedSocketIdentity>,
    event: ClientEventEnvelope,
  ): Promise<RealtimeCommandResult> {
    if (event.type === 'heartbeat.ping') {
      const socketMember = this.requiredSocketMember(socket);
      await Promise.all([
        this.presence.refresh(identity.guestSessionId, socketMember),
        this.connections.refresh(
          this.requiredAddressHash(socket),
          socketMember,
        ),
      ]);
      return {
        payload: {
          presenceExpiresInMs: this.presence.expiresInMs,
          serverTime: Date.now(),
        },
        type: 'heartbeat.pong',
      };
    }

    if (event.type === 'game.sync') {
      await Promise.allSettled([
        this.presence.refresh(
          identity.guestSessionId,
          this.requiredSocketMember(socket),
        ),
        this.connections.refresh(
          this.requiredAddressHash(socket),
          this.requiredSocketMember(socket),
        ),
      ]);
    }

    if (event.type === 'game.sync' && event.gameId === undefined) {
      const activeGameId = await this.activeGames.findActiveGameId(
        identity.guestSessionId,
      );
      if (activeGameId === null) {
        return {
          payload: this.sessionReadyPayload(identity, null),
          type: 'session.ready',
        };
      }
    }

    return this.commands.execute(event, {
      identity,
      joinGameRoom: async (gameId: string) => {
        await socket.join(gameRoom(gameId));
      },
      leaveGameRoom: async (gameId: string) => {
        await socket.leave(gameRoom(gameId));
      },
      socketId: socket.id,
    });
  }

  private async emitInitialGameSnapshot(
    socket: RealtimeSocket,
    identity: Readonly<AuthenticatedSocketIdentity>,
    gameId: string,
  ): Promise<void> {
    const result = await this.commands.execute(
      {
        eventId: randomUUID(),
        gameId,
        payload: {},
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now(),
        type: 'game.sync',
      },
      {
        identity,
        joinGameRoom: async (authorizedGameId: string) => {
          await socket.join(gameRoom(authorizedGameId));
        },
        leaveGameRoom: async (authorizedGameId: string) => {
          await socket.leave(gameRoom(authorizedGameId));
        },
        socketId: socket.id,
      },
    );
    if (result.type !== 'game.snapshot') {
      throw new Error('Active game recovery did not return a snapshot.');
    }
    const snapshot = this.protocol.createServerEvent({
      ...(socket.data.correlationId === undefined
        ? {}
        : { correlationId: socket.data.correlationId }),
      gameId,
      gameVersion: result.gameVersion,
      payload: result.payload,
      type: 'game.snapshot',
    });
    socket.emit(snapshot.type, snapshot);
  }

  private async sessionReadyEvent(
    identity: Readonly<AuthenticatedSocketIdentity>,
    correlationId: string | undefined,
  ): Promise<ServerEventEnvelope> {
    const activeGameId = await this.activeGames.findActiveGameId(
      identity.guestSessionId,
    );
    return this.protocol.createServerEvent({
      ...(correlationId === undefined ? {} : { correlationId }),
      payload: this.sessionReadyPayload(identity, activeGameId),
      type: 'session.ready',
    });
  }

  private sessionReadyPayload(
    identity: Readonly<AuthenticatedSocketIdentity>,
    activeGameId: string | null,
  ): {
    activeGameId: string | null;
    guest: {
      avatar: string;
      expiresAt: string;
      id: string;
      name: string;
    };
  } {
    return {
      activeGameId,
      guest: {
        avatar: identity.avatar,
        expiresAt: identity.expiresAt,
        id: identity.guestSessionId,
        name: identity.name,
      },
    };
  }

  private emitServerError(
    socket: RealtimeSocket,
    error: unknown,
    correlationId: string,
  ): void {
    const mapped = this.errors.map(error);
    const event = this.protocol.createServerEvent({
      correlationId,
      payload: mapped.error,
      type: 'server.error',
    });
    socket.emit(event.type, event);
  }

  private async drainConnections(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }

    const event = this.createDrainAdvisory();
    server.local.emit(event.type, event);
    const cleanupWindowMs = this.transactionTimeoutMs + 100;
    const workWindowMs = Math.max(
      0,
      this.drainTimeoutMs - this.drainGraceMs - cleanupWindowMs - 100,
    );
    const [idle] = await Promise.all([
      this.lifecycle.waitForIdle(workWindowMs),
      this.wait(this.drainGraceMs),
    ]);
    if (!idle) {
      this.logger.warn(
        { inFlightWork: this.lifecycle.inFlightWork },
        'Drain window elapsed with work still in flight',
      );
    }
    server.local.disconnectSockets(true);
    const cleanupIdle = await this.lifecycle.waitForIdle(cleanupWindowMs);
    if (!cleanupIdle) {
      this.logger.warn(
        { inFlightWork: this.lifecycle.inFlightWork },
        'Socket cleanup exceeded its transaction drain window',
      );
    }
  }

  private createDrainAdvisory(): ServerEventEnvelope {
    return this.protocol.createServerEvent({
      payload: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'This server is restarting; reconnect to another instance.',
        retryAfterMs: this.drainGraceMs,
        retryable: true,
      },
      type: 'server.error',
    });
  }

  private emitDrainAdvisory(socket: RealtimeSocket): void {
    const event = this.createDrainAdvisory();
    socket.emit(event.type, event);
  }

  private drainingHandshakeError(correlationId: string): SocketHandshakeError {
    const error = new Error(
      'This server is draining; reconnect to another instance.',
    ) as SocketHandshakeError;
    error.data = {
      code: 'SERVICE_UNAVAILABLE',
      correlationId,
      retryAfterMs: this.drainGraceMs,
      retryable: true,
    };
    return error;
  }

  private async cleanUpSocket(socket: RealtimeSocket): Promise<void> {
    const identity = socket.data.identity;
    const addressHash = socket.data.addressHash;
    const socketMember = socket.data.socketMember;
    if (
      identity === undefined ||
      addressHash === undefined ||
      socketMember === undefined
    ) {
      return;
    }

    const [presenceResult, connectionResult] = await Promise.allSettled([
      this.presence.remove(identity.guestSessionId, socketMember),
      this.connections.release(addressHash, socketMember),
    ]);
    if (presenceResult.status === 'fulfilled' && presenceResult.value === 0) {
      try {
        await this.presenceObserver.finallyDisconnected(
          identity.guestSessionId,
        );
      } catch {
        this.logger.warn('Final guest disconnect observer failed');
      }
    }
    if (
      presenceResult.status === 'rejected' ||
      connectionResult.status === 'rejected'
    ) {
      this.logger.warn('Realtime disconnect cleanup was incomplete');
    }
  }

  private identity(
    socket: RealtimeSocket,
  ): Readonly<AuthenticatedSocketIdentity> {
    if (socket.data.identity === undefined) {
      throw new Error('Socket identity is unavailable');
    }
    return socket.data.identity;
  }

  private rawCorrelationId(rawEnvelope: unknown): unknown {
    return typeof rawEnvelope === 'object' &&
      rawEnvelope !== null &&
      'correlationId' in rawEnvelope
      ? rawEnvelope.correlationId
      : undefined;
  }

  private requiredAddressHash(socket: RealtimeSocket): string {
    if (socket.data.addressHash === undefined) {
      throw new Error('Socket connection registry is unavailable');
    }
    return socket.data.addressHash;
  }

  private requiredSocketMember(socket: RealtimeSocket): string {
    if (socket.data.socketMember === undefined) {
      throw new Error('Socket presence member is unavailable');
    }
    return socket.data.socketMember;
  }

  private publishConnectionMetric(): void {
    this.metrics.setGauge(
      'cluchess_ws_connections',
      'Active WebSocket connections by application instance.',
      this.trackedSockets.size,
      { instance: this.instanceId },
    );
  }

  private async wait(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
}
