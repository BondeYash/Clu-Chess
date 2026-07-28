import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { IncomingMessage } from 'node:http';
import type { ServerOptions } from 'socket.io';
import { AppConfigService } from '../../../common/config/app-config.service.js';
import type { RealtimeServer } from '../realtime.types.js';
import { RealtimeRedisService } from './realtime-redis.service.js';

export class RedisStreamsIoAdapter extends IoAdapter {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    app: INestApplication,
    private readonly config: AppConfigService,
    private readonly realtimeRedis: RealtimeRedisService,
  ) {
    super(app);
    this.allowedOrigins = new Set(config.allowedOrigins);
  }

  async connect(): Promise<void> {
    await this.realtimeRedis.ensureConnected();
  }

  override createIOServer(
    port: number,
    options: Partial<ServerOptions> = {},
  ): RealtimeServer {
    const server = super.createIOServer(port, {
      ...options,
      allowRequest: (
        request: IncomingMessage,
        callback: (error: string | null, allowed: boolean) => void,
      ) => {
        callback(
          null,
          this.isAllowedOrigin(request.headers.origin) &&
            this.isAllowedTransport(request),
        );
      },
      connectionStateRecovery: {
        maxDisconnectionDuration:
          this.config.values.SOCKET_RECOVERY_MAX_DISCONNECTION_MS,
        skipMiddlewares: false,
      },
      cors: {
        credentials: true,
        origin: (
          origin: string | undefined,
          callback: (error: Error | null, allowed?: boolean) => void,
        ) => {
          if (this.isAllowedOrigin(origin)) {
            callback(null, true);
            return;
          }
          callback(new Error('Origin is not allowed'));
        },
      },
      maxHttpBufferSize: this.config.values.MAX_WS_BUFFER_BYTES,
      pingInterval: this.config.values.SOCKET_PING_INTERVAL_MS,
      pingTimeout: this.config.values.SOCKET_PING_TIMEOUT_MS,
      serveClient: false,
    }) as RealtimeServer;

    server.adapter(
      createAdapter(this.realtimeRedis.connection, {
        blockTimeInMs: 5000,
        maxLen: this.config.values.SOCKET_ADAPTER_STREAM_MAX_LEN,
        onlyPlaintext: true,
        sessionKeyPrefix: 'cluchess:sio:session:',
        streamName: 'cluchess:socket.io',
      }),
    );
    return server;
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    return origin !== undefined && this.allowedOrigins.has(origin);
  }

  private isAllowedTransport(request: IncomingMessage): boolean {
    if (!this.config.isProduction) {
      return true;
    }
    if ((request.socket as { encrypted?: boolean }).encrypted === true) {
      return true;
    }
    const forwardedProtocol = request.headers['x-forwarded-proto'];
    const value = Array.isArray(forwardedProtocol)
      ? forwardedProtocol[0]
      : forwardedProtocol;
    return value?.split(',')[0]?.trim().toLowerCase() === 'https';
  }
}

export async function configureRealtimeAdapter(
  app: INestApplication,
): Promise<void> {
  const adapter = new RedisStreamsIoAdapter(
    app,
    app.get(AppConfigService),
    app.get(RealtimeRedisService),
  );
  await adapter.connect();
  app.useWebSocketAdapter(adapter);
}
