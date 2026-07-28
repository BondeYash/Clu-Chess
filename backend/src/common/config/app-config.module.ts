import { Global, Module } from '@nestjs/common';
import { APP_ENVIRONMENT, AppConfigService } from './app-config.service.js';
import { assertRuntimeKeyFiles, parseEnvironment } from './config.schema.js';

@Global()
@Module({
  exports: [APP_ENVIRONMENT, AppConfigService],
  providers: [
    {
      provide: APP_ENVIRONMENT,
      useFactory: () => {
        const environment = parseEnvironment(process.env);
        assertRuntimeKeyFiles(environment);
        return environment;
      },
    },
    AppConfigService,
  ],
})
export class AppConfigModule {}
