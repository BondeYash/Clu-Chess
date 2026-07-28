import type { ReactNode } from 'react';

import { ApplicationFrame } from '@/components/layout/application-frame';

export default function GuestLayout({ children }: { children: ReactNode }) {
  return <ApplicationFrame>{children}</ApplicationFrame>;
}
