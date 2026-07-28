import type { ReactNode } from 'react';

import { ApplicationFrame } from '@/components/layout/application-frame';
import { GuestSessionGate } from '@/features/session/guest-session-gate';

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <ApplicationFrame>
      <GuestSessionGate>{children}</GuestSessionGate>
    </ApplicationFrame>
  );
}
