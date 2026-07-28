import { PROTOCOL_VERSION } from '@cluchess/protocol-v1/constants';
import { z } from 'zod';

const deploymentEnvironmentSchema = z.enum(['local', 'test', 'production']);
const publicBooleanSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const browserServiceOriginSchema = z.union([z.literal(''), z.url()]);

export const publicEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_API_ORIGIN: browserServiceOriginSchema.default(
      'http://localhost:3000',
    ),
    NEXT_PUBLIC_APP_ORIGIN: z.url().default('http://localhost:5173'),
    NEXT_PUBLIC_BUILD_SHA: z.string().min(1).max(128).default('development'),
    NEXT_PUBLIC_ENABLE_DEVTOOLS: publicBooleanSchema,
    NEXT_PUBLIC_FF_FRONTEND_TELEMETRY: publicBooleanSchema,
    NEXT_PUBLIC_FF_LEARN_HUB: publicBooleanSchema,
    NEXT_PUBLIC_FF_LESSON_HERO_ART: publicBooleanSchema,
    NEXT_PUBLIC_FF_SOUND_EFFECTS: publicBooleanSchema,
    NEXT_PUBLIC_PROTOCOL_VERSION: z.coerce
      .number()
      .int()
      .pipe(z.literal(PROTOCOL_VERSION))
      .default(PROTOCOL_VERSION),
    NEXT_PUBLIC_SOCKET_ORIGIN: browserServiceOriginSchema.default(
      'http://localhost:3000',
    ),
  })
  .strict();

export const frontendEnvironmentSchema = publicEnvironmentSchema
  .extend({
    FRONTEND_DEPLOYMENT_ENV: deploymentEnvironmentSchema.default('local'),
  })
  .superRefine((environment, context) => {
    if (environment.FRONTEND_DEPLOYMENT_ENV !== 'production') {
      return;
    }

    for (const key of [
      'NEXT_PUBLIC_API_ORIGIN',
      'NEXT_PUBLIC_APP_ORIGIN',
      'NEXT_PUBLIC_SOCKET_ORIGIN',
    ] as const) {
      if (environment[key] === '') {
        continue;
      }
      const protocol = new URL(environment[key]).protocol;
      if (protocol !== 'https:' && protocol !== 'wss:') {
        context.addIssue({
          code: 'custom',
          message: `${key} must use HTTPS or WSS in production`,
          path: [key],
        });
      }
    }

    if (environment.NEXT_PUBLIC_ENABLE_DEVTOOLS) {
      context.addIssue({
        code: 'custom',
        message: 'Public developer tools must be disabled in production',
        path: ['NEXT_PUBLIC_ENABLE_DEVTOOLS'],
      });
    }
  });

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;
export type FrontendEnvironment = z.infer<typeof frontendEnvironmentSchema>;

const publicSecretPattern =
  /(secret|password|private|token|credential|api_key)/i;

export function parsePublicEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): PublicEnvironment {
  assertNoPublicSecrets(source);
  return publicEnvironmentSchema.parse(pickEnvironment(source));
}

export function parseFrontendEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): FrontendEnvironment {
  assertNoPublicSecrets(source);
  return frontendEnvironmentSchema.parse({
    ...pickEnvironment(source),
    FRONTEND_DEPLOYMENT_ENV: source.FRONTEND_DEPLOYMENT_ENV,
  });
}

function assertNoPublicSecrets(
  source: Readonly<Record<string, string | undefined>>,
): void {
  const exposedSecret = Object.keys(source).find(
    (key) => key.startsWith('NEXT_PUBLIC_') && publicSecretPattern.test(key),
  );

  if (exposedSecret) {
    throw new Error(
      `${exposedSecret} looks sensitive and cannot use the NEXT_PUBLIC_ prefix`,
    );
  }
}

function pickEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_API_ORIGIN: source.NEXT_PUBLIC_API_ORIGIN,
    NEXT_PUBLIC_APP_ORIGIN: source.NEXT_PUBLIC_APP_ORIGIN,
    NEXT_PUBLIC_BUILD_SHA: source.NEXT_PUBLIC_BUILD_SHA,
    NEXT_PUBLIC_ENABLE_DEVTOOLS: source.NEXT_PUBLIC_ENABLE_DEVTOOLS,
    NEXT_PUBLIC_FF_FRONTEND_TELEMETRY: source.NEXT_PUBLIC_FF_FRONTEND_TELEMETRY,
    NEXT_PUBLIC_FF_LEARN_HUB: source.NEXT_PUBLIC_FF_LEARN_HUB,
    NEXT_PUBLIC_FF_LESSON_HERO_ART: source.NEXT_PUBLIC_FF_LESSON_HERO_ART,
    NEXT_PUBLIC_FF_SOUND_EFFECTS: source.NEXT_PUBLIC_FF_SOUND_EFFECTS,
    NEXT_PUBLIC_PROTOCOL_VERSION: source.NEXT_PUBLIC_PROTOCOL_VERSION,
    NEXT_PUBLIC_SOCKET_ORIGIN: source.NEXT_PUBLIC_SOCKET_ORIGIN,
  };
}
