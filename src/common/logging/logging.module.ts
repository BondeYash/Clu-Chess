import { Global, Module, RequestMethod } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { CorrelationContextService } from './correlation-context.service.js';
import { validCorrelationId } from './correlation-id.middleware.js';

@Global()
@Module({
  exports: [CorrelationContextService, LoggerModule],
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
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers.set-cookie',
              'token',
              '*.token',
              'jti',
              '*.jti',
              'password',
              '*.password',
              'privateKey',
              '*.privateKey',
              'DATABASE_URL',
              'REDIS_URL',
            ],
          },
        },
      }),
    }),
  ],
  providers: [CorrelationContextService],
})
export class LoggingModule {}
