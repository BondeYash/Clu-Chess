'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from 'react';

import { queryKeys } from '@/lib/query-keys';

import {
  sessionCoordinator,
  type GuestIdentity,
  type SessionBootstrapResult,
} from './session-coordinator';

type SessionView =
  | {
      activeGameId: string | null;
      activeGameStatus: 'available' | 'unavailable';
      guest: GuestIdentity;
      status: 'ready';
    }
  | {
      activeGameId: string | null;
      status: 'identity-lost';
    }
  | { error: unknown; status: 'error' }
  | { status: 'anonymous' | 'idle' | 'loading' };

export interface GuestSessionContextValue {
  isResetting: boolean;
  resetError: unknown;
  resetGuest(): Promise<void>;
  retry(): Promise<void>;
  view: SessionView;
}

const GuestSessionContext = createContext<GuestSessionContextValue | null>(
  null,
);

export function GuestSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const queryClient = useQueryClient();
  const allowCreate = isGuestRoute(pathname);
  const enabled = allowCreate || pathname === '/';
  const key = queryKeys.session.bootstrap(allowCreate);
  const sessionQuery = useQuery({
    enabled,
    queryFn: () => sessionCoordinator.bootstrap({ allowCreate }),
    queryKey: key,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 5 * 60 * 1_000,
  });
  const resetMutation = useMutation({
    mutationFn: () => sessionCoordinator.resetAndCreate(),
    onSuccess: (next) => {
      queryClient.removeQueries({ queryKey: queryKeys.session.all });
      queryClient.setQueryData(key, next);
    },
  });

  const result = sessionQuery.data;
  useEffect(() => {
    if (!result || result.status !== 'ready') return;
    const delay = sessionCoordinator.renewalDelay(result);
    if (delay === null) return;
    const timer = window.setTimeout(
      () => {
        void sessionCoordinator
          .renewReadySession(result)
          .then((next) => {
            queryClient.setQueriesData<SessionBootstrapResult>(
              { queryKey: queryKeys.session.all },
              next,
            );
          })
          .catch(() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.session.all,
            });
          });
      },
      Math.min(delay, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [queryClient, result]);

  const view = useMemo<SessionView>(
    () =>
      !enabled
        ? { status: 'idle' }
        : sessionQuery.isPending
          ? { status: 'loading' }
          : sessionQuery.isError
            ? { error: sessionQuery.error, status: 'error' }
            : (sessionQuery.data ?? { status: 'loading' }),
    [
      enabled,
      sessionQuery.data,
      sessionQuery.error,
      sessionQuery.isError,
      sessionQuery.isPending,
    ],
  );

  const value = useMemo<GuestSessionContextValue>(
    () => ({
      isResetting: resetMutation.isPending,
      resetError: resetMutation.error,
      async resetGuest() {
        await resetMutation.mutateAsync();
      },
      async retry() {
        await sessionQuery.refetch();
      },
      view,
    }),
    [resetMutation, sessionQuery, view],
  );

  return (
    <GuestSessionContext.Provider value={value}>
      {children}
    </GuestSessionContext.Provider>
  );
}

export function useGuestSession(): GuestSessionContextValue {
  const value = useContext(GuestSessionContext);
  if (!value) {
    throw new Error('useGuestSession must be used inside GuestSessionProvider');
  }
  return value;
}

export function useOptionalGuestSession(): GuestSessionContextValue | null {
  return useContext(GuestSessionContext);
}

function isGuestRoute(pathname: string): boolean {
  return (
    pathname === '/play' ||
    pathname === '/settings' ||
    pathname.startsWith('/game/')
  );
}
