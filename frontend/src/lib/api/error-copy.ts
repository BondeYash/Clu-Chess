import { isApiError } from './api-error';

export interface ErrorPresentation {
  actionLabel: string;
  correlationId?: string | undefined;
  message: string;
  title: string;
}

const COPY: Record<string, Omit<ErrorPresentation, 'correlationId'>> = {
  IDEMPOTENCY_KEY_REUSED: {
    actionLabel: 'Start again',
    message:
      'That protected request key belongs to another action. No duplicate identity was created.',
    title: 'The request could not be replayed',
  },
  INVALID_RESPONSE: {
    actionLabel: 'Try again',
    message:
      'CluChess returned data this browser version could not safely understand.',
    title: 'CluChess needs a fresh response',
  },
  NETWORK_ERROR: {
    actionLabel: 'Try again',
    message:
      'Check your connection. Your last confirmed identity remains safe.',
    title: 'CluChess could not be reached',
  },
  RATE_LIMITED: {
    actionLabel: 'Try again shortly',
    message: 'Too many requests arrived together. Please wait a moment.',
    title: 'The board needs a brief pause',
  },
  REQUEST_TIMEOUT: {
    actionLabel: 'Try again',
    message:
      'The request took too long. Retrying will reuse its protected request key.',
    title: 'The service is responding slowly',
  },
  SERVICE_UNAVAILABLE: {
    actionLabel: 'Try again',
    message:
      'The service is temporarily unavailable. Your confirmed identity has not been replaced.',
    title: 'CluChess is temporarily unavailable',
  },
  UNAUTHORIZED: {
    actionLabel: 'Recover identity',
    message:
      'This tab could not prove its guest identity. An active game will never be moved to a new guest silently.',
    title: 'Your guest session needs attention',
  },
};

export function presentApiError(error: unknown): ErrorPresentation {
  const apiError = isApiError(error) ? error : undefined;
  const copy = COPY[apiError?.code ?? ''] ?? {
    actionLabel: 'Try again',
    message:
      'The request could not be completed. Confirmed session data remains unchanged.',
    title: 'Something interrupted the request',
  };
  return { ...copy, correlationId: apiError?.correlationId };
}
