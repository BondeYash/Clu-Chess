import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../src/common/config/app-config.service.js';
import { parseEnvironment } from '../../src/common/config/config.schema.js';

describe('AppConfigService', () => {
  it('exposes immutable values and a normalized origin allowlist', () => {
    const environment = parseEnvironment({
      ORIGIN_ALLOWLIST: 'http://one.local, http://two.local',
    });
    const config = new AppConfigService(environment);

    expect(config.values).toBe(environment);
    expect(config.allowedOrigins).toEqual([
      'http://one.local',
      'http://two.local',
    ]);
    expect(Object.isFrozen(config.allowedOrigins)).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it('identifies production configuration', () => {
    const config = new AppConfigService(
      parseEnvironment({
        NODE_ENV: 'production',
        ORIGIN_ALLOWLIST: 'https://chess.example',
      }),
    );

    expect(config.isProduction).toBe(true);
  });
});
