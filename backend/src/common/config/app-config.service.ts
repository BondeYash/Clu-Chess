import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
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

  get metricsBearerToken(): string | undefined {
    if (!this.isProduction) {
      return undefined;
    }
    return readFileSync(
      this.environment.METRICS_BEARER_TOKEN_FILE,
      'utf8',
    ).trim();
  }
}
