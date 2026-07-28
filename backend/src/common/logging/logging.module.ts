import { Global, Module, RequestMethod } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { CorrelationContextService } from './correlation-context.service.js';
import { validCorrelationId } from './correlation-id.middleware.js';
import { SafeLogContextService } from './safe-log-context.service.js';

export const LOG_REDACTION_PATHS = Object.freeze([
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.proxy-authorization',
  'req.remoteAddress',
  'req.remotePort',
  'res.headers.set-cookie',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'token',
  '*.token',
  'jti',
  '*.jti',
  'password',
  '*.password',
  'privateKey',
  '*.privateKey',
  'jwtPrivateKey',
  '*.jwtPrivateKey',
  'DATABASE_URL',
  'REDIS_URL',
  'databaseUrl',
  '*.databaseUrl',
  'redisUrl',
  '*.redisUrl',
]);

@Global()
@Module({
  exports: [CorrelationContextService, LoggerModule, SafeLogContextService],
  imports: [
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        forRoutes: [{ method: RequestMethod.ALL, path: '{*path}' }],
        pinoHttp: {
          level: config.values.LOG_LEVEL,
          genReqId: (request, response) => {
            const supplied = request.headers['x-correlation-id'];
            const requestId = validCorrelationId(supplied)
              ? supplied
              : randomUUID();
            response.setHeader('X-Correlation-Id', requestId);
            return requestId;
          },
          redact: {
            censor: '[REDACTED]',
            paths: [...LOG_REDACTION_PATHS],
          },
        },
      }),
    }),
  ],
  providers: [CorrelationContextService, SafeLogContextService],
})
export class LoggingModule {}
