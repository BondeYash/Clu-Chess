import type { Metadata } from 'next';

import { LegalPage } from '@/components/content/legal-page';

export const metadata: Metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Product terms preview"
      summary="Play fairly, respect the service boundaries, and remember that an anonymous identity is temporary."
      title="Terms"
    >
      <h2>Fair play</h2>
      <p>
        Do not automate play, interfere with another guest, or attempt to bypass
        rate limits and authoritative move validation.
      </p>
      <h2>Temporary identities</h2>
      <p>
        Generated names are not accounts. An expired or reset identity cannot be
        restored from another browser or device.
      </p>
    </LegalPage>
  );
}
