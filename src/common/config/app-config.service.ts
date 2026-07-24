import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from './config.schema.js';

export const APP_ENVIRONMENT = Symbol('APP_ENVIRONMENT');

@Injectable()
export class AppConfigService {
  constructor(
    @Inject(APP_ENVIRONMENT)
    private readonly environment: AppEnvironment,
  ) {}

  get values(): AppEnvironment {
    return this.environment;
  }

  get allowedOrigins(): readonly string[] {
    return Object.freeze(
      this.environment.ORIGIN_ALLOWLIST.split(',').map((origin) =>
        origin.trim(),
      ),
    );
  }

  get isProduction(): boolean {
    return this.environment.NODE_ENV === 'production';
  }
}
