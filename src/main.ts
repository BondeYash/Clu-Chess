import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfigService } from './common/config/app-config.service.js';
import { ApplicationLifecycleService } from './common/lifecycle/application-lifecycle.service.js';
import { shutdownTelemetry } from './instrumentation.js';
import { configureRealtimeAdapter } from './modules/realtime/infrastructure/redis-streams-io.adapter.js';

process.env.TZ = 'UTC';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);
  const lifecycle = app.get(ApplicationLifecycleService);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.setGlobalPrefix('v1', {
    exclude: [
      { method: RequestMethod.ALL, path: 'healthz' },
      { method: RequestMethod.ALL, path: 'readyz' },
      { method: RequestMethod.ALL, path: 'metrics' },
    ],
  });
  app.enableCors({
    credentials: true,
    origin: [...config.allowedOrigins],
  });
  await configureRealtimeAdapter(app);
  await app.listen(config.values.PORT, '0.0.0.0');
  logger.log(
    `CluChess backend listening on port ${String(config.values.PORT)}`,
    'Bootstrap',
  );

  installShutdownHandlers(app, lifecycle, config, logger);
}

function installShutdownHandlers(
  app: INestApplication,
  lifecycle: ApplicationLifecycleService,
  config: AppConfigService,
  logger: Logger,
): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, config.values.DRAIN_TIMEOUT_MS).unref();
    });
    await Promise.race([lifecycle.beginDrain(signal), timeout]);
    await app.close();
    await shutdownTelemetry();
    logger.log('Graceful shutdown complete', 'Bootstrap');
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).catch((error: unknown) => {
        logger.error({ error }, 'Graceful shutdown failed', 'Bootstrap');
        process.exitCode = 1;
      });
    });
  }
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Application startup failed'}\n`,
  );
  process.exitCode = 1;
});
