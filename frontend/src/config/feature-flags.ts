import { publicEnvironment } from './environment';

export const featureFlags = {
  frontendTelemetry: publicEnvironment.NEXT_PUBLIC_FF_FRONTEND_TELEMETRY,
  learnHub: publicEnvironment.NEXT_PUBLIC_FF_LEARN_HUB,
  lessonHeroArt: publicEnvironment.NEXT_PUBLIC_FF_LESSON_HERO_ART,
  soundEffects: publicEnvironment.NEXT_PUBLIC_FF_SOUND_EFFECTS,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export const featureFlagRegistry = {
  frontendTelemetry: {
    owner: 'platform',
    removalCondition: 'Remove when frontend telemetry is a required baseline.',
  },
  learnHub: {
    owner: 'learning',
    removalCondition:
      'Remove after the learning hub completes release rollout.',
  },
  lessonHeroArt: {
    owner: 'design',
    removalCondition:
      'Remove after licensed hero art passes performance gates.',
  },
  soundEffects: {
    owner: 'gameplay',
    removalCondition:
      'Remove after sound controls complete accessibility review.',
  },
} as const satisfies Record<
  FeatureFlag,
  { owner: string; removalCondition: string }
>;
