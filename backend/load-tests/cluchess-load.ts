const profileName = process.env.LOAD_PROFILE ?? 'smoke';

const profiles = {
  smoke: {
    phases: [{ arrivalCount: 4, duration: 1, name: 'qualification-smoke' }],
    scenarios: [{ flow: [{ function: 'runGameUser' }], name: 'game-user' }],
  },
  target: {
    phases: [
      {
        arrivalCount: 2000,
        duration: 300,
        name: 'ramp-to-2000-connections',
      },
    ],
    scenarios: [
      {
        flow: [{ function: 'runGameUser' }],
        name: 'game-user',
        weight: 85,
      },
      {
        flow: [{ function: 'runQueueChurnUser' }],
        name: 'queue-churn-user',
        weight: 15,
      },
    ],
  },
  stress: {
    phases: [
      {
        arrivalCount: 2500,
        duration: 300,
        name: 'ramp-to-2500-physical-sockets',
      },
    ],
    scenarios: [
      {
        flow: [{ function: 'runSocketOnlyUser' }],
        name: 'authenticated-physical-socket',
      },
    ],
  },
  burst: {
    phases: [
      {
        arrivalCount: 1000,
        duration: 10,
        name: '500-game-move-burst',
      },
    ],
    scenarios: [
      { flow: [{ function: 'runGameUser' }], name: 'burst-game-user' },
    ],
  },
  soak: {
    phases: [
      {
        arrivalCount: 200,
        duration: 300,
        name: 'lower-volume-soak-ramp',
      },
    ],
    scenarios: [
      {
        flow: [{ function: 'runGameUser' }],
        name: 'soak-game-user',
        weight: 90,
      },
      {
        flow: [{ function: 'runQueueChurnUser' }],
        name: 'soak-queue-churn',
        weight: 10,
      },
    ],
  },
};

const profile = profiles[profileName];
if (profile === undefined) {
  throw new Error(
    `Unsupported LOAD_PROFILE ${profileName}; expected ${Object.keys(profiles).join(', ')}`,
  );
}

export const config = {
  phases: profile.phases,
  processor: './processor.mjs',
  target: process.env.LOAD_BASE_URL ?? 'https://nginx',
  tls: { rejectUnauthorized: false },
};

export const scenarios = profile.scenarios;
