'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { GuestSessionProvider } from '@/features/session/session-provider';
import { createQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <GuestSessionProvider>{children}</GuestSessionProvider>
    </QueryClientProvider>
  );
}
