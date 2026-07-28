import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { publicEnvironment } from '@/config/environment';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  applicationName: 'Cluchess',
  description:
    'A calm, server-authoritative place to play a focused game of chess.',
  metadataBase: new URL(publicEnvironment.NEXT_PUBLIC_APP_ORIGIN),
  title: {
    default: 'Cluchess',
    template: '%s · Cluchess',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f3f0e8',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
