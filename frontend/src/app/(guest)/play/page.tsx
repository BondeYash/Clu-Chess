import type { Metadata } from 'next';

import { PlaySessionView } from '@/features/session/play-session-view';

export const metadata: Metadata = {
  title: 'Play',
};

export default function PlayPage() {
  return <PlaySessionView />;
}
