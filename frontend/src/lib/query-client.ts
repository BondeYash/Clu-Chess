import { QueryClient } from '@tanstack/react-query';

import { isApiError } from './api/api-error';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          failureCount < 2 &&
          isApiError(error) &&
          error.retryable &&
          error.status !== 401,
        staleTime: 30_000,
      },
    },
  });
}
