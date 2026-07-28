export const queryKeys = {
  games: {
    active: ['games', 'active'] as const,
    all: ['games'] as const,
  },
  session: {
    all: ['session'] as const,
    bootstrap: (allowCreate: boolean) =>
      ['session', 'bootstrap', allowCreate ? 'ensure' : 'recover'] as const,
    current: ['session', 'current'] as const,
  },
} as const;
