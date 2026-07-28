import type { Metadata } from 'next';

import { LegalPage } from '@/components/content/legal-page';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Plain-language policy preview"
      summary="CluChess uses generated guest identities and does not require an email address or social account."
      title="Privacy"
    >
      <h2>Anonymous is still authenticated</h2>
      <p>
        A short-lived guest credential protects your queue and game. It stays in
        this browser session and cannot identify you across devices.
      </p>
      <h2>Operational data</h2>
      <p>
        The service retains the minimum game and security data needed for
        authoritative play, recovery, abuse prevention, and reliability.
      </p>
    </LegalPage>
  );
}
